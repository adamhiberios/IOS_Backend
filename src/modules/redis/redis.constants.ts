/** DI token for the main ioredis command client. */
export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * DI token for the dedicated subscriber client.
 * A subscriber connection can only run PubSub commands, so it must be
 * a separate ioredis instance from REDIS_CLIENT.
 */
export const REDIS_SUBSCRIBER = 'REDIS_SUBSCRIBER';

// ── Key prefixes ────────────────────────────────────────────────────────────

/** Active exam session: `exam:session:{sessionId}` — TTL = exam duration. */
export const EXAM_SESSION_PREFIX = 'exam:session:';

/**
 * Late-submit grace window: `exam:grace:{sessionId}` — TTL = GRACE_WINDOW_SECONDS.
 * Created when the active session key expires; deleted on late-submit or auto-submit.
 */
export const EXAM_GRACE_PREFIX = 'exam:grace:';

/** Seconds the student has to submit after the session clock hits zero (BE-037). */
export const GRACE_WINDOW_SECONDS = 120;

// ── Event names (EventEmitter2) ─────────────────────────────────────────────

/**
 * Fired by REDIS_SUBSCRIBER when a keyspace-expiry event matches one of the
 * exam key prefixes above. Payload: `{ type: 'session' | 'grace', sessionId }`.
 */
export const REDIS_KEYSPACE_EXPIRED = 'redis.keyspace.expired';
