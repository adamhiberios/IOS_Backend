import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { I18nContext, I18nService } from 'nestjs-i18n';
import {
  AppException,
  ErrorCode,
  ValidationErrorItem,
  codeToSlug,
} from '../errors';

/**
 * Catches every thrown exception and renders it as an RFC 7807 Problem
 * Details body, localized through nestjs-i18n.
 *
 * Resolution rules (top to bottom — first match wins):
 *   1. `AppException` → use its declared `code` + `i18nKey` + `i18nArgs`.
 *   2. class-validator's `BadRequestException` → flatten to
 *      `code = VALIDATION_FAILED`, populate `errors[]`.
 *   3. Any other `HttpException` → derive code from its status.
 *   4. Anything else → 500 `INTERNAL`, log the real error, never leak detail.
 *
 * Locale is read from `I18nContext.current(host)` which is populated by the
 * resolver chain in `AppI18nModule`. If for any reason the context is absent
 * (very early bootstrap, non-HTTP transport) we fall back to `en`.
 *
 * Auth anomalies worth investigating (`REFRESH_TOKEN_REUSED`) and every 5xx
 * are flagged in the log line with `level=error`; the rest are warn/debug.
 * Sentry integration plugs in here in Week 7 (BE-040) — see TaskTracker.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly i18n: I18nService) {}

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const i18nContext = I18nContext.current(host);
    const lang = i18nContext?.lang ?? process.env.DEFAULT_LOCALE ?? 'en';

    const resolved = this.resolve(exception);

    // Title is always translated. Detail is either translated (AppException
    // path — full localisation) or preserved verbatim (generic HttpException
    // path — original message wins so callers like `new UnauthorizedException(
    // 'Email not verified')` keep their semantics). Translating boilerplate
    // would lose information the test suite and downstream consumers depend on.
    const title = await this.i18n.t(`${resolved.i18nKey}.title`, {
      lang,
      args: resolved.i18nArgs,
    });
    const detail =
      resolved.rawDetail !== undefined
        ? resolved.rawDetail
        : await this.i18n.t(`${resolved.i18nKey}.detail`, {
            lang,
            args: resolved.i18nArgs,
          });

    // Request ID — propagated to the response header for client correlation
    // and into the log line for server-side debugging. If a request-scoped
    // middleware (Week 7) is already setting `X-Request-Id`, honour it.
    const requestId =
      (request.headers['x-request-id'] as string | undefined) ?? randomUUID();
    response.setHeader('X-Request-Id', requestId);

    const body = {
      type: `https://ios-lms.com/errors/${codeToSlug(resolved.code)}`,
      title,
      status: resolved.status,
      detail,
      instance: request.originalUrl ?? request.url,
      code: resolved.code,
      request_id: requestId,
      errors: resolved.errors ?? null,
      timestamp: new Date().toISOString(),
    };

    this.log(resolved, request, requestId, exception);

    response
      .status(resolved.status)
      .type('application/problem+json')
      .json(body);
  }

  // ── private ──────────────────────────────────────────────────────────

  private resolve(exception: unknown): {
    status: number;
    code: string;
    i18nKey: string;
    i18nArgs: Record<string, unknown>;
    /**
     * If set, used verbatim as `body.detail` instead of running the i18n
     * resolver against `${i18nKey}.detail`. Reserved for generic HttpException
     * messages where the caller's wording carries information we don't want
     * to flatten (e.g. "Email not verified" vs "Invalid credentials").
     */
    rawDetail?: string;
    errors?: ValidationErrorItem[] | null;
  } {
    // 1. AppException — first-class path, fully translated.
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        i18nKey: exception.i18nKey,
        i18nArgs: exception.i18nArgs,
        errors: exception.errors,
      };
    }

    // 2. class-validator BadRequestException — `message` is the array of
    //    constraint failures. Surface as VALIDATION_FAILED with errors[],
    //    keep status at 400 (matches existing test expectations and the
    //    existing convention; the architecture study lists 400/422 as
    //    equivalent, the codebase already standardised on 400).
    if (exception instanceof BadRequestException) {
      const resp = exception.getResponse();
      const isValidatorOutput =
        typeof resp === 'object' &&
        resp !== null &&
        Array.isArray((resp as { message?: unknown }).message);

      if (isValidatorOutput) {
        return {
          status: HttpStatus.BAD_REQUEST,
          code: ErrorCode.VALIDATION_FAILED,
          i18nKey: 'errors.validation.failed',
          i18nArgs: {},
          errors: this.flattenValidatorMessages(resp),
        };
      }

      // Manually thrown BadRequestException (e.g. domain code checking a
      // cross-field invariant). Preserve the caller's message — the test
      // suite for token-race + others depends on this.
      const rawDetail = this.extractRawMessage(resp, exception.message);
      return {
        status: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_FAILED,
        i18nKey: 'errors.validation.failed', // title path only
        i18nArgs: {},
        rawDetail,
      };
    }

    // 3. Any other HttpException — map status to a registry code, but keep
    //    the original message as `detail`. Translating boilerplate over the
    //    top would erase the information the caller chose to surface.
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const rawDetail = this.extractRawMessage(
        exception.getResponse(),
        exception.message,
      );
      return {
        status,
        code: this.statusToCode(status),
        i18nKey: this.statusToI18nKey(status), // for title localisation
        i18nArgs: {},
        rawDetail,
      };
    }

    // 4. Unknown — never leak. Log the real cause, return generic.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL,
      i18nKey: 'errors.infrastructure.internal',
      i18nArgs: {},
    };
  }

  /**
   * Pulls the original message string out of an HttpException's response body
   * regardless of whether it's a bare string or the `{ message, ... }` object
   * Nest wraps it in by default.
   */
  private extractRawMessage(
    response: string | object,
    fallback: string,
  ): string {
    if (typeof response === 'string') return response;
    const obj = response as { message?: string | string[] };
    if (typeof obj.message === 'string') return obj.message;
    if (Array.isArray(obj.message)) return obj.message.join('; ');
    return fallback;
  }

  /**
   * class-validator throws `BadRequestException` with the response body
   * containing either a string or `{ message: string[], error: ... }`. We
   * convert both shapes into a uniform `ValidationErrorItem[]`.
   */
  private flattenValidatorMessages(
    body: string | object,
  ): ValidationErrorItem[] {
    if (typeof body === 'string') {
      return [{ field: '_root', code: 'INVALID', message: body }];
    }

    const obj = body as { message?: string | string[]; errors?: unknown };
    const raw = obj.message ?? obj.errors;

    if (typeof raw === 'string') {
      return [{ field: '_root', code: 'INVALID', message: raw }];
    }
    if (Array.isArray(raw)) {
      return raw.map((entry) => {
        if (typeof entry === 'string') {
          return { field: '_root', code: 'INVALID', message: entry };
        }
        const e = entry as {
          property?: string;
          constraints?: Record<string, string>;
        };
        const firstConstraint = e.constraints
          ? Object.entries(e.constraints)[0]
          : undefined;
        return {
          field: e.property ?? '_root',
          code: firstConstraint?.[0]?.toUpperCase() ?? 'INVALID',
          message: firstConstraint?.[1] ?? 'Invalid',
          constraints: e.constraints,
        };
      });
    }
    return [{ field: '_root', code: 'INVALID', message: 'Validation failed' }];
  }

  private statusToCode(status: number): string {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.JWT_INVALID;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.INSUFFICIENT_ROLE;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.RESOURCE_NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.RESOURCE_ALREADY_EXISTS;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.RATE_LIMITED;
      case HttpStatus.UNPROCESSABLE_ENTITY:
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.VALIDATION_FAILED;
      default:
        return ErrorCode.INTERNAL;
    }
  }

  private statusToI18nKey(status: number): string {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return 'errors.auth.jwt_invalid';
      case HttpStatus.FORBIDDEN:
        return 'errors.auth.insufficient_role';
      case HttpStatus.NOT_FOUND:
        return 'errors.domain.resource_not_found';
      case HttpStatus.CONFLICT:
        return 'errors.domain.resource_already_exists';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'errors.infrastructure.rate_limited';
      case HttpStatus.UNPROCESSABLE_ENTITY:
      case HttpStatus.BAD_REQUEST:
        return 'errors.validation.failed';
      default:
        return 'errors.infrastructure.internal';
    }
  }

  private log(
    resolved: { status: number; code: string },
    request: Request,
    requestId: string,
    exception: unknown,
  ): void {
    const meta = {
      requestId,
      status: resolved.status,
      code: resolved.code,
      method: request.method,
      path: request.originalUrl ?? request.url,
    };

    if (resolved.status >= 500) {
      this.logger.error(
        `[${meta.code}] ${meta.method} ${meta.path} (req ${meta.requestId})`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      return;
    }

    // Surface refresh-token reuse — likely indicates a compromised session.
    if (resolved.code === ErrorCode.REFRESH_TOKEN_REUSED) {
      this.logger.warn(
        `[${meta.code}] suspicious refresh on ${meta.path} (req ${meta.requestId})`,
      );
      return;
    }

    if (resolved.status >= 400 && resolved.code !== ErrorCode.VALIDATION_FAILED) {
      this.logger.warn(`[${meta.code}] ${meta.method} ${meta.path}`);
    } else {
      this.logger.debug(`[${meta.code}] ${meta.method} ${meta.path}`);
    }
  }
}
