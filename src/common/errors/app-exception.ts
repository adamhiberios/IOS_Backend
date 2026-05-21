import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Single shape carried by every domain error in the system. Stays in lockstep
 * with the RFC 7807 response body emitted by GlobalExceptionFilter.
 *
 * Fields:
 *   - `code`        stable, machine-readable identifier. Frontends switch on
 *                   this; the wording on `title`/`detail` may change per
 *                   locale but the code is a contract.
 *   - `i18nKey`     translation key resolved by nestjs-i18n. Conventionally
 *                   `errors.<family>.<snake_case_code>`, with `.title` and
 *                   `.detail` sub-keys.
 *   - `i18nArgs`    interpolation values for the translation (e.g. `usedAt`).
 *   - `errors`      optional per-field validation breakdown.
 */
export interface ValidationErrorItem {
  field: string;
  code: string;
  message: string;
  constraints?: Record<string, unknown>;
}

/**
 * Base class every domain exception extends. Carries the translation key plus
 * structured args; the global filter does the actual locale resolution at
 * request time so the same exception renders correctly to any client.
 *
 * Subclasses must declare a `readonly code` matching the family taxonomy in
 * the architecture study §3.2.
 */
export abstract class AppException extends HttpException {
  abstract readonly code: string;

  constructor(
    status: HttpStatus,
    public readonly i18nKey: string,
    public readonly i18nArgs: Record<string, unknown> = {},
    public readonly errors?: ValidationErrorItem[],
  ) {
    // We pass a placeholder message into HttpException — the filter overrides
    // the body entirely with the localized RFC 7807 shape. Keeping a useful
    // string here means Nest's default logger still surfaces something
    // readable if the filter is somehow bypassed.
    super({ message: i18nKey }, status);
  }
}
