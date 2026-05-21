import { HttpStatus } from '@nestjs/common';
import { AppException } from '../app-exception';
import { ErrorCode } from '../error-codes';

/** Authenticated but the role doesn't include access to this endpoint. */
export class InsufficientRoleException extends AppException {
  readonly code = ErrorCode.INSUFFICIENT_ROLE;
  constructor(required: string[]) {
    super(HttpStatus.FORBIDDEN, 'errors.auth.insufficient_role', {
      required: required.join(', '),
    });
  }
}

/**
 * Caller is authenticated but does not own the resource they're trying to
 * read or mutate. Service-layer ownership check (the complement of scoped
 * RLS for tables that aren't covered by ADR-010).
 */
export class OwnershipViolationException extends AppException {
  readonly code = ErrorCode.OWNERSHIP_VIOLATION;
  constructor(resource: string) {
    super(HttpStatus.FORBIDDEN, 'errors.auth.ownership_violation', { resource });
  }
}
