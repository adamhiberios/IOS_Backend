import { HttpStatus } from '@nestjs/common';
import { AppException } from '../app-exception';
import { ErrorCode } from '../error-codes';

/** Generic 404 wrapper for domain entities (Catalog, Exam, etc.). */
export class ResourceNotFoundException extends AppException {
  readonly code = ErrorCode.RESOURCE_NOT_FOUND;
  constructor(resource: string, identifier?: string | number) {
    super(HttpStatus.NOT_FOUND, 'errors.domain.resource_not_found', {
      resource,
      identifier: identifier ?? '',
    });
  }
}

/** Generic 409 wrapper for "unique constraint would be violated". */
export class ResourceAlreadyExistsException extends AppException {
  readonly code = ErrorCode.RESOURCE_ALREADY_EXISTS;
  constructor(resource: string) {
    super(HttpStatus.CONFLICT, 'errors.domain.resource_already_exists', { resource });
  }
}

/** Registration attempted with an email that's already on file. */
export class EmailAlreadyRegisteredException extends AppException {
  readonly code = ErrorCode.EMAIL_ALREADY_REGISTERED;
  constructor() {
    super(HttpStatus.CONFLICT, 'errors.domain.email_already_registered');
  }
}
