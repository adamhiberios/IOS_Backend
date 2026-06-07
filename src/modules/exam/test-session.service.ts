import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import {
  EXAM_SESSION_PREFIX,
  EXAM_GRACE_PREFIX,
  GRACE_WINDOW_SECONDS,
} from '../redis/redis.constants';

/** Shape of the JSON stored at `exam:session:{sessionId}`. */
export interface ExamSessionData {
  sessionId: string;
  userId: string;
  examId: string;
  certId: string;
  startedAt: string; // ISO 8601
  answers: Record<string, string>; // { questionId: optionId }
}

/**
 * TestSessionService — pure Redis exam-session CRUD (BE-034).
 *
 * Design invariants:
 *  - `start` sets a hard TTL equal to the exam's duration. That TTL is the
 *    authoritative countdown timer — it is NEVER reset, not even on autosave.
 *  - `autosave` uses SET…KEEPTTL so the snapshot is updated while the
 *    deadline stays immutable.
 *  - On natural submit: the session key is deleted immediately so no
 *    keyspace-expiry event fires.
 *  - On timeout: the session key expires naturally → keyspace event fires →
 *    ExamKeyspaceHandler calls `startGrace`, which opens a 2-minute window
 *    for late-submit (BE-037).
 */
@Injectable()
export class TestSessionService {
  constructor(private readonly redis: RedisService) {}

  // ── Active session ──────────────────────────────────────────────────────

  /**
   * Create a new Redis exam session with the given TTL.
   * Answers start empty — they are populated via `autosave`.
   */
  async start(
    data: Omit<ExamSessionData, 'answers'>,
    ttlSeconds: number,
  ): Promise<void> {
    const sessionData: ExamSessionData = { ...data, answers: {} };
    await this.redis.setJson(
      `${EXAM_SESSION_PREFIX}${data.sessionId}`,
      sessionData,
      ttlSeconds,
    );
  }

  /**
   * Persist the latest answer snapshot WITHOUT touching the TTL.
   * Returns `false` if the session has already expired in Redis.
   */
  async autosave(
    sessionId: string,
    answers: Record<string, string>,
  ): Promise<boolean> {
    const key = `${EXAM_SESSION_PREFIX}${sessionId}`;
    const existing = await this.redis.getJson<ExamSessionData>(key);
    if (!existing) return false;
    return this.redis.setJsonKeepTtl(key, { ...existing, answers });
  }

  /** Read session data plus the remaining TTL in milliseconds. */
  async getSession(
    sessionId: string,
  ): Promise<{ data: ExamSessionData | null; pttlMs: number }> {
    const key = `${EXAM_SESSION_PREFIX}${sessionId}`;
    const [data, pttlMs] = await Promise.all([
      this.redis.getJson<ExamSessionData>(key),
      this.redis.pttl(key),
    ]);
    return { data, pttlMs };
  }

  /**
   * Delete the active session key.
   * Called on successful submit so no spurious expiry event fires.
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.redis.del(`${EXAM_SESSION_PREFIX}${sessionId}`);
  }

  // ── Grace window (BE-037) ────────────────────────────────────────────────

  /**
   * Open a 2-minute grace window after session expiry.
   * Stores the last known answer snapshot so the keyspace handler can
   * auto-submit from it if the student never calls late-submit.
   */
  async startGrace(
    sessionId: string,
    snapshot: Record<string, string>,
  ): Promise<void> {
    await this.redis.setJson(
      `${EXAM_GRACE_PREFIX}${sessionId}`,
      { snapshot },
      GRACE_WINDOW_SECONDS,
    );
  }

  /**
   * Atomically read and delete the grace-window key.
   * Returns the snapshot if the grace window is still open, null otherwise.
   * (Consuming the key prevents double-submit.)
   */
  async consumeGrace(
    sessionId: string,
  ): Promise<Record<string, string> | null> {
    const key = `${EXAM_GRACE_PREFIX}${sessionId}`;
    const data = await this.redis.getJson<{ snapshot: Record<string, string> }>(
      key,
    );
    if (data) await this.redis.del(key);
    return data?.snapshot ?? null;
  }

  /** Non-destructive grace-window check (used to gate the late-submit endpoint). */
  async hasGrace(sessionId: string): Promise<boolean> {
    const pttl = await this.redis.pttl(`${EXAM_GRACE_PREFIX}${sessionId}`);
    return pttl > 0;
  }
}
