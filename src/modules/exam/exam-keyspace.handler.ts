import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TestSession, TestSessionStatus } from '../../database/entities/test-session.entity';
import { ExamService } from './exam.service';
import { ExamGateway } from './exam.gateway';
import { TestSessionService } from './test-session.service';
import { REDIS_KEYSPACE_EXPIRED } from '../redis/redis.constants';

interface KeyspaceExpiredPayload {
  type: 'session' | 'grace';
  sessionId: string;
}

/**
 * ExamKeyspaceHandler (BE-036 + BE-037)
 *
 * Listens for `redis.keyspace.expired` events emitted by RedisModule when an
 * exam key expires in Redis. Two key types are handled:
 *
 * 1. `exam:session:{id}` expires (type = 'session'):
 *    - Update TestSession.status = EXPIRED in Postgres.
 *    - Open a 2-minute grace window in Redis (`exam:grace:{id}`) populated
 *      with the last autosaved snapshot from Postgres.
 *    - Emit `session_expired` to the student's WS room so the UI can show
 *      the late-submit countdown.
 *
 * 2. `exam:grace:{id}` expires (type = 'grace'):
 *    - Grace window has also elapsed without a late-submit.
 *    - Auto-submit from the DB snapshot (ExamService.autoSubmitFromSnapshot).
 *    - Attempt is persisted with status AUTO_SUBMITTED.
 */
@Injectable()
export class ExamKeyspaceHandler {
  private readonly logger = new Logger(ExamKeyspaceHandler.name);

  constructor(
    @InjectRepository(TestSession)
    private readonly testSessionRepo: Repository<TestSession>,
    private readonly examService: ExamService,
    private readonly gateway: ExamGateway,
    private readonly testSessionSvc: TestSessionService,
  ) {}

  @OnEvent(REDIS_KEYSPACE_EXPIRED, { async: true })
  async handleExpiry(payload: KeyspaceExpiredPayload): Promise<void> {
    const { type, sessionId } = payload;

    if (type === 'session') {
      await this.handleSessionExpiry(sessionId);
    } else if (type === 'grace') {
      await this.handleGraceExpiry(sessionId);
    }
  }

  // ── Session expiry ────────────────────────────────────────────────────────

  private async handleSessionExpiry(sessionId: string): Promise<void> {
    this.logger.log(`Session expired: ${sessionId}`);

    const session = await this.testSessionRepo.findOne({
      where: { id: sessionId },
    });

    if (!session) {
      this.logger.warn(`Expired session ${sessionId} not found in DB`);
      return;
    }

    if (session.status !== TestSessionStatus.ACTIVE) {
      // Already submitted or handled — nothing to do.
      this.logger.debug(
        `Session ${sessionId} already in status '${session.status}' — skipping expiry`,
      );
      return;
    }

    // Mark session as EXPIRED in Postgres.
    await this.testSessionRepo.update(sessionId, {
      status: TestSessionStatus.EXPIRED,
    });

    // Open grace window — store the last DB snapshot so auto-submit
    // has something to score if the student never calls late-submit.
    const snapshot =
      (session.snapshot as Record<string, string> | null) ?? {};

    await this.testSessionSvc.startGrace(sessionId, snapshot);

    // Notify the student via WebSocket.
    this.gateway.emitSessionExpired(sessionId);

    this.logger.log(
      `Grace window opened for session ${sessionId} (${Object.keys(snapshot).length} answers in snapshot)`,
    );
  }

  // ── Grace expiry → auto-submit ────────────────────────────────────────────

  private async handleGraceExpiry(sessionId: string): Promise<void> {
    this.logger.log(`Grace window expired — auto-submitting session ${sessionId}`);

    // ExamService.autoSubmitFromSnapshot is idempotent: if the student
    // already submitted during the grace window, the session status won't
    // be EXPIRED anymore and the method returns early.
    await this.examService.autoSubmitFromSnapshot(sessionId);
  }
}
