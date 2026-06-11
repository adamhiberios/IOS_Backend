import { Injectable, Inject, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

/**
 * Thin typed wrapper around the ioredis command client.
 *
 * All exam-session state is stored as JSON strings. Using typed helpers here
 * keeps the deserialization logic in one place and makes mocking in unit tests
 * trivial (mock RedisService, not the raw Redis client).
 */
@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  // ── JSON helpers ────────────────────────────────────────────────────────

  /** SET key to JSON-serialized value with an absolute TTL in seconds. */
  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  /**
   * Overwrite the JSON value while KEEPING the existing TTL.
   * Uses the `KEEPTTL` option available in Redis ≥ 6.
   *
   * Returns `false` if the key no longer exists (already expired).
   * This is the correct autosave primitive — autosave must never reset the
   * exam countdown.
   */
  async setJsonKeepTtl(key: string, value: unknown): Promise<boolean> {
    // Single atomic command: XX = only write if the key still exists.
    // The previous PTTL-check-then-SET had a race where the key could expire
    // between the two commands and SET KEEPTTL would recreate it WITHOUT a
    // TTL — an immortal session key (H1, audit 2026-06-11).
    const result = await this.client.set(
      key,
      JSON.stringify(value),
      'KEEPTTL',
      'XX',
    );
    return result === 'OK';
  }

  /** GET and deserialize. Returns `null` if the key is absent or expired. */
  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.error(`Failed to parse JSON for key ${key}`, err);
      return null;
    }
  }

  /**
   * Atomically GET and DELETE (single GETDEL command, Redis ≥ 6.2).
   * Returns `null` if the key is absent. Unlike GET-then-DEL, two concurrent
   * callers can never both receive the value (H2, audit 2026-06-11).
   */
  async getDelJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.getdel(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.error(`Failed to parse JSON for key ${key}`, err);
      return null;
    }
  }

  // ── TTL helpers ─────────────────────────────────────────────────────────

  /**
   * Returns remaining TTL in milliseconds.
   * -2 = key does not exist.
   * -1 = key exists but has no TTL.
   */
  async pttl(key: string): Promise<number> {
    return this.client.pttl(key);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  /** Health-check ping — used by /health/full. */
  async ping(): Promise<string> {
    return this.client.ping();
  }
}
