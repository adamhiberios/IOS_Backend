import { HttpStatus } from '@nestjs/common';
import { AppException, ValidationErrorItem } from '../app-exception';
import { ErrorCode } from '../error-codes';

/**
 * Composite validation failure — surface every field-level breach in the
 * `errors[]` array. Emitted by the GlobalExceptionFilter when class-validator
 * raises a `BadRequestException`, but can also be thrown directly from
 * services for cross-field rules that class-validator can't express.
 */
export class ValidationFailedException extends AppException {
  readonly code = ErrorCode.VALIDATION_FAILED;
  constructor(errors: ValidationErrorItem[]) {
    super(HttpStatus.BAD_REQUEST, 'errors.validation.failed', {}, errors);
  }
}

/**
 * Caller asked for a locale that isn't in `SUPPORTED_LOCALES`. We return 400
 * deliberately rather than silently falling back to `en` — silent fallback
 * hides client bugs.
 */
export class InvalidLocaleException extends AppException {
  readonly code = ErrorCode.INVALID_LOCALE;
  constructor(requested: string) {
    super(HttpStatus.BAD_REQUEST, 'errors.validation.invalid_locale', {
      requested,
    });
  }
}
