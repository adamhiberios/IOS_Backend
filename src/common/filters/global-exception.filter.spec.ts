import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { I18nContext, I18nService } from 'nestjs-i18n';
import { GlobalExceptionFilter } from './global-exception.filter';
import {
  ErrorCode,
  InvalidCredentialsException,
  RefreshTokenReusedException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '../errors';

const buildHost = (
  req: Partial<Request>,
  res: Partial<Response>,
): ArgumentsHost =>
  ({
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
    getType: () => 'http',
  }) as unknown as ArgumentsHost;

/**
 * I18nService mock — returns a deterministic stringification of the key and
 * args so tests can assert that the filter resolved through the right key.
 */
function buildI18nMock() {
  const t = jest.fn(
    async (
      key: string,
      opts?: { lang?: string; args?: Record<string, unknown> },
    ) => {
      // Only surface args when there are actual values — the filter passes
      // an empty {} for argless exceptions, which is semantically "no args".
      const argSuffix =
        opts?.args && Object.keys(opts.args).length > 0
          ? `|${JSON.stringify(opts.args)}`
          : '';
      return `[${opts?.lang ?? '?'}]${key}${argSuffix}`;
    },
  );
  return { service: { t } as unknown as I18nService, t };
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let i18nMock: ReturnType<typeof buildI18nMock>;
  let res: { status: jest.Mock; json: jest.Mock; type: jest.Mock; setHeader: jest.Mock };
  let req: Partial<Request>;

  beforeEach(() => {
    i18nMock = buildI18nMock();
    filter = new GlobalExceptionFilter(i18nMock.service);

    // Silence the logger for clean test output.
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
    jest.spyOn(filter['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(filter['logger'], 'debug').mockImplementation(() => undefined);

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
    };
    req = {
      method: 'POST',
      url: '/api/v1/test',
      originalUrl: '/api/v1/test',
      headers: {},
    };

    // Default I18nContext returns 'en' lang; individual tests can override.
    jest
      .spyOn(I18nContext, 'current')
      .mockReturnValue({ lang: 'en' } as unknown as I18nContext);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── AppException — the first-class path ─────────────────────────────────

  it('localises an AppException via its i18nKey and adds the registered code', async () => {
    await filter.catch(
      new InvalidCredentialsException(),
      buildHost(req, res),
    );

    expect(res.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    expect(res.type).toHaveBeenCalledWith('application/problem+json');
    const body = res.json.mock.calls[0][0];
    expect(body).toMatchObject({
      type: 'https://ios-lms.com/errors/invalid-credentials',
      title: '[en]errors.auth.invalid_credentials.title',
      detail: '[en]errors.auth.invalid_credentials.detail',
      status: 401,
      code: ErrorCode.INVALID_CREDENTIALS,
      instance: '/api/v1/test',
      errors: null,
    });
    expect(body.request_id).toEqual(expect.any(String));
    expect(body.timestamp).toEqual(expect.any(String));
  });

  it('honours an inbound X-Request-Id rather than generating a new one', async () => {
    req.headers = { 'x-request-id': '01HZX0000000000000000000AA' };
    await filter.catch(new InvalidCredentialsException(), buildHost(req, res));
    const body = res.json.mock.calls[0][0];
    expect(body.request_id).toBe('01HZX0000000000000000000AA');
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Request-Id',
      '01HZX0000000000000000000AA',
    );
  });

  it('interpolates i18nArgs into the translation call', async () => {
    await filter.catch(
      new ResourceNotFoundException('certificate', 'IOS-PSM-2026-000142'),
      buildHost(req, res),
    );

    expect(i18nMock.t).toHaveBeenCalledWith(
      'errors.domain.resource_not_found.title',
      {
        lang: 'en',
        args: { resource: 'certificate', identifier: 'IOS-PSM-2026-000142' },
      },
    );
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
    expect(body.status).toBe(404);
  });

  it('resolves through the lang from I18nContext when set to a non-default locale', async () => {
    jest
      .spyOn(I18nContext, 'current')
      .mockReturnValue({ lang: 'tr' } as unknown as I18nContext);

    await filter.catch(new InvalidCredentialsException(), buildHost(req, res));
    expect(i18nMock.t).toHaveBeenCalledWith(
      'errors.auth.invalid_credentials.title',
      expect.objectContaining({ lang: 'tr' }),
    );
  });

  // ── class-validator BadRequestException ─────────────────────────────────

  it('flattens class-validator output into errors[] with VALIDATION_FAILED at status 400', async () => {
    const exception = new BadRequestException({
      message: [
        {
          property: 'email',
          constraints: { isEmail: 'email must be a valid email' },
        },
        {
          property: 'password',
          constraints: { minLength: 'password must be at least 8 chars' },
        },
      ],
    });
    await filter.catch(exception, buildHost(req, res));

    const body = res.json.mock.calls[0][0];
    expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(body.errors).toHaveLength(2);
    expect(body.errors[0]).toMatchObject({
      field: 'email',
      code: 'ISEMAIL',
      message: 'email must be a valid email',
    });
  });

  it('handles BadRequestException with a string body as a manual throw — message preserved verbatim', async () => {
    // String-body BadRequest is treated as a service-thrown error, not a
    // class-validator output. The original message becomes `detail` and the
    // structured `errors[]` array is null (there's nothing to break down).
    await filter.catch(
      new BadRequestException('invalid'),
      buildHost(req, res),
    );
    const body = res.json.mock.calls[0][0];
    expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(body.detail).toBe('invalid');
    expect(body.errors).toBeNull();
  });

  it('preserves the original message for a manually-thrown UnauthorizedException', async () => {
    await filter.catch(
      new UnauthorizedException('Email not verified. Check your inbox.'),
      buildHost(req, res),
    );
    const body = res.json.mock.calls[0][0];
    expect(res.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    expect(body.detail).toBe('Email not verified. Check your inbox.');
  });

  it('passes through an explicit ValidationFailedException', async () => {
    await filter.catch(
      new ValidationFailedException([
        { field: 'startDate', code: 'AFTER_END', message: 'start must precede end' },
      ]),
      buildHost(req, res),
    );
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(body.errors[0].field).toBe('startDate');
    expect(body.errors[0].code).toBe('AFTER_END');
  });

  // ── Generic HttpException ───────────────────────────────────────────────

  it('maps a vanilla NotFoundException to RESOURCE_NOT_FOUND', async () => {
    await filter.catch(new NotFoundException('nope'), buildHost(req, res));
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
    expect(body.status).toBe(404);
  });

  it('maps a custom HttpException by status code', async () => {
    class TeapotException extends HttpException {
      constructor() {
        super('teapot', 418);
      }
    }
    await filter.catch(new TeapotException(), buildHost(req, res));
    const body = res.json.mock.calls[0][0];
    expect(body.status).toBe(418);
    expect(body.code).toBe(ErrorCode.INTERNAL); // 418 isn't in the table, defaults to INTERNAL
  });

  // ── Unknown errors — never leak ─────────────────────────────────────────

  it('returns 500 generic INTERNAL for unknown errors without leaking stack', async () => {
    const exception = new Error(
      'DB error: connection string is "postgres://leaked"',
    );
    await filter.catch(exception, buildHost(req, res));

    expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe(ErrorCode.INTERNAL);
    expect(body.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('postgres://leaked');
  });

  // ── Logging signals worth investigating ─────────────────────────────────

  it('warn-logs refresh-token reuse as a security signal', async () => {
    const warnSpy = filter['logger'].warn as unknown as jest.Mock;
    await filter.catch(
      new RefreshTokenReusedException(),
      buildHost(req, res),
    );
    expect(warnSpy).toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe(ErrorCode.REFRESH_TOKEN_REUSED);
    expect(body.status).toBe(401);
  });

  it('error-logs every 5xx with the original stack', async () => {
    const errSpy = filter['logger'].error as unknown as jest.Mock;
    await filter.catch(new Error('boom'), buildHost(req, res));
    expect(errSpy).toHaveBeenCalled();
  });
});
