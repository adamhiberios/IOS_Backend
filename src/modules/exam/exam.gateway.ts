import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WsException,
} from '@nestjs/websockets';
import { Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { TestSessionService } from './test-session.service';

// ── Constants ────────────────────────────────────────────────────────────────

/** How often the server emits a `timer_tick` event to the client (ms). */
const TICK_INTERVAL_MS = 30_000;

/** Remaining-time thresholds (seconds) that trigger a `warning` event. */
const WARNING_THRESHOLDS = [600, 300];

/** Room prefix — each exam session gets its own socket.io room. */
const SESSION_ROOM = (sessionId: string) => `session:${sessionId}`;

// ── Types ────────────────────────────────────────────────────────────────────

interface TimerEntry {
  intervalId: NodeJS.Timeout;
  warnedThresholds: Set<number>;
}

interface JoinSessionPayload {
  sessionId: string;
}

/**
 * ExamGateway (BE-035)
 *
 * WebSocket gateway for real-time exam timer updates.
 *
 * Namespace: /exam
 * Transport: WebSocket (with polling fallback)
 *
 * Auth:
 *   Clients must pass `{ auth: { token: '<JWT>' } }` in the handshake.
 *   The JWT middleware verifies the token and attaches `socket.data.userId`.
 *   Sockets that fail auth are disconnected immediately.
 *
 * Client events (C→S):
 *   join_session { sessionId }  — join the session room and start/attach timer
 *
 * Server events (S→C):
 *   timer_tick       { sessionId, remainingSeconds }  — every 30 s
 *   warning          { sessionId, remainingSeconds, threshold }  — at 600s, 300s
 *   session_expired  { sessionId }  — when Redis TTL hits zero (via keyspace handler)
 *
 * Multi-instance note:
 *   The @socket.io/redis-adapter ensures WS events emitted on any instance are
 *   delivered to all connected clients. However, the per-session setInterval
 *   runs on whichever instance the first client connects to. In a multi-instance
 *   deployment, this should be replaced with BullMQ repeatable jobs.
 */
// Mirrors the HTTP CORS policy in src/main.ts. Wide-open WS CORS combined
// with credentials:true is a CSWSH (cross-site WebSocket hijacking) risk,
// even when auth lives in the handshake — long-polling fallback travels over
// HTTP and inherits browser CORS semantics. Keep this in lockstep with the
// HTTP origin so a single env change moves both.
const WS_CORS_ORIGIN = process.env.APP_BASE_URL ?? 'http://localhost:4000';

@WebSocketGateway({
  namespace: '/exam',
  cors: {
    origin: WS_CORS_ORIGIN,
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class ExamGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ExamGateway.name);

  /** Map<sessionId, TimerEntry> — one timer per active exam session. */
  private readonly timers = new Map<string, TimerEntry>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly testSessionSvc: TestSessionService,
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
  ) {}

  // ── Lifecycle ────────────────────────────────────────────────────────────

  afterInit(server: Server): void {
    // Wire the Redis adapter so events are broadcast across instances.
    // When the gateway uses a namespace, `server` is a Namespace object.
    // The adapter() method lives on the parent Server, accessible via .server.
    const pubClient = this.redisClient;
    const subClient = new Redis(this.configService.get<string>('REDIS_URL')!);
    (server as any).server
      ? (server as any).server.adapter(createAdapter(pubClient, subClient))
      : server.adapter(createAdapter(pubClient, subClient));
    this.logger.log('ExamGateway initialized with Redis adapter');

    // JWT middleware — runs before every connection is accepted.
    server.use((socket: Socket, next) => {
      try {
        const token: string | undefined =
          socket.handshake.auth?.token ??
          (socket.handshake.headers?.authorization as string | undefined)?.split(' ')[1];

        if (!token) {
          return next(new WsException('Missing authentication token'));
        }

        const payload = this.jwtService.verify<{ sub: string }>(token, {
          secret: this.configService.get<string>('JWT_SECRET')!,
        });

        // Attach user identity to the socket for downstream handlers.
        socket.data.userId = payload.sub;
        next();
      } catch {
        next(new WsException('Invalid or expired token'));
      }
    });
  }

  handleConnection(socket: Socket): void {
    this.logger.debug(`Client connected: ${socket.id} userId=${socket.data.userId}`);
  }

  handleDisconnect(socket: Socket): void {
    this.logger.debug(`Client disconnected: ${socket.id}`);
    // Rooms clean up automatically. Timers are cleared when the session
    // room becomes empty — handled in join_session room-leave logic.
  }

  // ── Message handlers ─────────────────────────────────────────────────────

  /**
   * Client joins an exam session room.
   * Starts a 30-second tick interval if one isn't already running for this session.
   */
  @SubscribeMessage('join_session')
  async handleJoinSession(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: JoinSessionPayload,
  ): Promise<{ joined: boolean; remainingSeconds: number }> {
    const { sessionId } = payload;

    // Ownership check — student may only join their own session.
    const { data, pttlMs } = await this.testSessionSvc.getSession(sessionId);

    if (!data || data.userId !== socket.data.userId) {
      throw new WsException('Session not found or does not belong to this user');
    }

    const room = SESSION_ROOM(sessionId);
    await socket.join(room);
    this.logger.log(`Socket ${socket.id} joined room ${room}`);

    // Start the tick interval if this is the first subscriber for this session.
    if (!this.timers.has(sessionId)) {
      this.startTimer(sessionId);
    }

    const remainingSeconds = pttlMs > 0 ? Math.ceil(pttlMs / 1000) : 0;
    return { joined: true, remainingSeconds };
  }

  // ── Public emit methods (called by ExamKeyspaceHandler) ─────────────────

  emitSessionExpired(sessionId: string): void {
    const room = SESSION_ROOM(sessionId);
    this.server.to(room).emit('session_expired', { sessionId });
    this.clearTimer(sessionId);
    this.logger.log(`Emitted session_expired to room ${room}`);
  }

  // ── Timer management ─────────────────────────────────────────────────────

  private startTimer(sessionId: string): void {
    const warnedThresholds = new Set<number>();

    const intervalId = setInterval(async () => {
      try {
        const { pttlMs } = await this.testSessionSvc.getSession(sessionId);

        if (pttlMs <= 0) {
          // Redis key gone — keyspace handler will fire session_expired via event.
          this.clearTimer(sessionId);
          return;
        }

        const remainingSeconds = Math.ceil(pttlMs / 1000);
        const room = SESSION_ROOM(sessionId);

        // Regular tick.
        this.server.to(room).emit('timer_tick', { sessionId, remainingSeconds });

        // Warning thresholds.
        for (const threshold of WARNING_THRESHOLDS) {
          if (
            remainingSeconds <= threshold &&
            !warnedThresholds.has(threshold)
          ) {
            warnedThresholds.add(threshold);
            this.server.to(room).emit('warning', {
              sessionId,
              remainingSeconds,
              threshold,
            });
            this.logger.log(
              `Warning emitted: sessionId=${sessionId} threshold=${threshold}s`,
            );
          }
        }
      } catch (err) {
        this.logger.error(
          `Timer tick failed for session ${sessionId}: ${(err as Error).message}`,
        );
      }
    }, TICK_INTERVAL_MS);

    this.timers.set(sessionId, { intervalId, warnedThresholds });
    this.logger.debug(`Timer started for session ${sessionId}`);
  }

  private clearTimer(sessionId: string): void {
    const entry = this.timers.get(sessionId);
    if (entry) {
      clearInterval(entry.intervalId);
      this.timers.delete(sessionId);
      this.logger.debug(`Timer cleared for session ${sessionId}`);
    }
  }

  /** Called by ExamService on normal submit to clean up the timer. */
  clearSessionTimer(sessionId: string): void {
    this.clearTimer(sessionId);
  }
}
