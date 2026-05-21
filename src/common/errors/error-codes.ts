/**
 * Registry of every error code the API can emit. Two reasons this exists as
 * a single source of truth:
 *
 *   1. Frontends switch on `code` — adding a new one requires a deliberate
 *      decision, not a one-off string literal buried in a service.
 *   2. The `/errors/:code` docs page is generated from this list, as is the
 *      OpenAPI error enum and the i18n key audit.
 *
 * Codes are grouped by the 5 families in the architecture study §3.2.
 * Adding a code = update this enum + add `errors.<family>.<snake_code>`
 * entries (`.title` + `.detail`) in every locale resource file.
 */
export const ErrorCode = {
  // ── VALIDATION ────────────────────────────────────────────────────────
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_LOCALE: 'INVALID_LOCALE',

  // ── AUTHENTICATION (401) ──────────────────────────────────────────────
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  JWT_EXPIRED: 'JWT_EXPIRED',
  JWT_INVALID: 'JWT_INVALID',
  REFRESH_TOKEN_REUSED: 'REFRESH_TOKEN_REUSED',
  REFRESH_TOKEN_INVALID: 'REFRESH_TOKEN_INVALID',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',

  // ── AUTHORIZATION (403) ───────────────────────────────────────────────
  INSUFFICIENT_ROLE: 'INSUFFICIENT_ROLE',
  OWNERSHIP_VIOLATION: 'OWNERSHIP_VIOLATION',

  // ── DOMAIN (404/409/410/422) ──────────────────────────────────────────
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  RESOURCE_ALREADY_EXISTS: 'RESOURCE_ALREADY_EXISTS',
  EMAIL_ALREADY_REGISTERED: 'EMAIL_ALREADY_REGISTERED',

  // ── INFRASTRUCTURE (5xx) ──────────────────────────────────────────────
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCodeKey = keyof typeof ErrorCode;
export type ErrorCodeValue = (typeof ErrorCode)[ErrorCodeKey];

/**
 * Convert a code to a kebab-case slug for use in the `type` URL of the
 * RFC 7807 response (e.g. `EMAIL_ALREADY_REGISTERED` →
 * `email-already-registered`). Stable: the slug is part of the URL contract.
 */
export function codeToSlug(code: string): string {
  return code.toLowerCase().replace(/_/g, '-');
}
