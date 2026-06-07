import { Global, Module, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import Redis from 'ioredis';

import { RedisService } from './redis.service';
import {
  REDIS_CLIENT,
  REDIS_SUBSCRIBER,
  EXAM_SESSION_PREFIX,
  EXAM_GRACE_PREFIX,
  REDIS_KEYSPACE_EXPIRED,
} from './redis.constants';

const logger = new Logger('RedisModule');

function makeClient(url: string, name: string): Redis {
  const client = new Redis(url, {
    lazyConnect: false,
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 100, 3000),
  });
  client.on('connect', () => logger.log(`[${name}] connected`));
  client.on('ready', () => logger.log(`[${name}] ready`));
  client.on('error', (err: Error) => logger.error(`[${name}] error: ${err.message}`));
  client.on('close', () => logger.warn(`[${name}] connection closed`));
  return client;
}

/**
 * RedisModule — @Global()
 *
 * Exports:
 *  - RedisService     — typed JSON helpers for the app
 *  - REDIS_CLIENT     — raw ioredis instance (commands)
 *  - REDIS_SUBSCRIBER — raw ioredis instance (PubSub, keyspace events)
 *
 * Keyspace bridge:
 *   The subscriber listens on `__keyevent@0__:expired` (enabled in
 *   docker/redis/redis.conf via `notify-keyspace-events Ex`).
 *   When a key matching `exam:session:*` or `exam:grace:*` expires, it
 *   emits a `redis.keyspace.expired` event on the NestJS EventEmitter2 bus
 *   so the ExamKeyspaceHandler can react without being coupled to ioredis.
 */
@Global()
@Module({
  providers: [
    // ── Main command client ──────────────────────────────────────────────
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService) => {
        return makeClient(config.get<string>('REDIS_URL')!, 'REDIS_CLIENT');
      },
      inject: [ConfigService],
    },

    // ── Subscriber client (PubSub only) ──────────────────────────────────
    {
      provide: REDIS_SUBSCRIBER,
      useFactory: (config: ConfigService, eventEmitter: EventEmitter2) => {
        const subscriber = makeClient(
          config.get<string>('REDIS_URL')!,
          'REDIS_SUBSCRIBER',
        );

        // Subscribe to keyspace expiry events for DB 0.
        // Redis publishes to `__keyevent@{db}__:expired` when any key with a
        // TTL expires. Our redis.conf already has `notify-keyspace-events Ex`.
        subscriber.subscribe('__keyevent@0__:expired', (err) => {
          if (err) logger.error(`subscribe error: ${err.message}`);
          else logger.log('Subscribed to __keyevent@0__:expired');
        });

        subscriber.on('message', (_channel: string, key: string) => {
          if (key.startsWith(EXAM_SESSION_PREFIX)) {
            const sessionId = key.slice(EXAM_SESSION_PREFIX.length);
            eventEmitter.emit(REDIS_KEYSPACE_EXPIRED, {
              type: 'session',
              sessionId,
            });
          } else if (key.startsWith(EXAM_GRACE_PREFIX)) {
            const sessionId = key.slice(EXAM_GRACE_PREFIX.length);
            eventEmitter.emit(REDIS_KEYSPACE_EXPIRED, {
              type: 'grace',
              sessionId,
            });
          }
        });

        return subscriber;
      },
      inject: [ConfigService, EventEmitter2],
    },

    RedisService,
  ],
  exports: [RedisService, REDIS_CLIENT, REDIS_SUBSCRIBER],
})
export class RedisModule {}
