/**
 * Shape of claims inside our JWTs.
 *
 * Note: `sub` is the user/admin UUID as a string.
 *       `jti` is the refresh_tokens.id (SERIAL, number) — that table is
 *       internal-only and uses incremental IDs by design (ADR-on-IDs).
 */

export interface AccessTokenPayload {
  /** Subject — user UUID (students) or admin user UUID (admins). */
  sub: string;
  /** Account type. */
  type: 'student' | 'admin';
  /** Email at time of issuance. */
  email: string;
  /** Locale at time of issuance — used for i18n. */
  locale: string;
  /** Admin role — only present when type='admin'. */
  role?: string;
}

export interface RefreshTokenPayload {
  /** Subject — user UUID or admin UUID. */
  sub: string;
  /** Account type. */
  type: 'student' | 'admin';
  /** Unique token id — matches refresh_tokens.id (serial int) in DB. */
  jti: number;
}
