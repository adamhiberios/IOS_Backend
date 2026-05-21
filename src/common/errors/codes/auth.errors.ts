import { HttpStatus } from '@nestjs/common';
import { AppException } from '../app-exception';
import { ErrorCode } from '../error-codes';

/** Submitted email/password do not match an active account. */
export class InvalidCredentialsException extends AppException {
  readonly code = ErrorCode.INVALID_CREDENTIALS;
  constructor() {
    super(HttpStatus.UNAUTHORIZED, 'errors.auth.invalid_credentials');
  }
}

/** Access JWT expired. Frontend should call /auth/refresh and retry once. */
export class JwtExpiredException extends AppException {
  readonly code = ErrorCode.JWT_EXPIRED;
  constructor() {
    super(HttpStatus.UNAUTHORIZED, 'errors.auth.jwt_expired');
  }
}

/** JWT signature invalid or malformed — never legitimate, force logout. */
export class JwtInvalidException extends AppException {
  readonly code = ErrorCode.JWT_INVALID;
  constructor() {
    super(HttpStatus.UNAUTHORIZED, 'errors.auth.jwt_invalid');
  }
}

/**
 * Refresh token was presented but had already been rotated out. Indicates
 * either a stolen token or a client bug; in both cases we revoke the entire
 * session family and force a fresh login. The global filter additionally
 * reports this one to Sentry — see GlobalExceptionFilter.
 */
export class RefreshTokenReusedException extends AppException {
  readonly code = ErrorCode.REFRESH_TOKEN_REUSED;
  constructor() {
    super(HttpStatus.UNAUTHORIZED, 'errors.auth.refresh_token_reused');
  }
}

/** Refresh token absent, malformed, or revoked. Force re-login. */
export class RefreshTokenInvalidException extends AppException {
  readonly code = ErrorCode.REFRESH_TOKEN_INVALID;
  constructor() {
    super(HttpStatus.UNAUTHORIZED, 'errors.auth.refresh_token_invalid');
  }
}

/** Account exists but email is not yet verified — login blocked. */
export class EmailNotVerifiedException extends AppException {
  readonly code = ErrorCode.EMAIL_NOT_VERIFIED;
  constructor() {
    super(HttpStatus.UNAUTHORIZED, 'errors.auth.email_not_verified');
  }
}

/** Account has been disabled by an admin. */
export class AccountDisabledException extends AppException {
  readonly code = ErrorCode.ACCOUNT_DISABLED;
  constructor() {
    super(HttpStatus.UNAUTHORIZED, 'errors.auth.account_disabled');
  }
}
