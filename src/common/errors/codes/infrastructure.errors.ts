import { HttpStatus } from '@nestjs/common';
import { AppException } from '../app-exception';
import { ErrorCode } from '../error-codes';

/**
 * ThrottlerGuard-style rate limit hit. Carries a `Retry-After` value so the
 * frontend can implement well-behaved backoff. The actual header is set by
 * the throttler's response handler — this exception captures the same
 * value for the body so machine clients have it in one place.
 */
export class RateLimitedException extends AppException {
  readonly code = ErrorCode.RATE_LIMITED;
  constructor(retryAfterSeconds: number) {
    super(HttpStatus.TOO_MANY_REQUESTS, 'errors.infrastructure.rate_limited', {
      retryAfterSeconds,
    });
  }
}

/**
 * Last-resort 500. Never thrown directly — emitted by the global filter when
 * an unknown error escapes a service. Kept in the registry so the docs page
 * exists and the FE has a canonical code to display.
 */
export class InternalServerException extends AppException {
  readonly code = ErrorCode.INTERNAL;
  constructor() {
    super(HttpStatus.INTERNAL_SERVER_ERROR, 'errors.infrastructure.internal');
  }
}
