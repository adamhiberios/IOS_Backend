import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { GlobalExceptionFilter } from './global-exception.filter';

const buildHost = (
  req: Partial<Request>,
  res: Partial<Response>,
): ArgumentsHost =>
  ({
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  }) as unknown as ArgumentsHost;

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let res: { status: jest.Mock; json: jest.Mock };
  let req: Partial<Request>;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    // Silence the internal Logger.error() call used for non-HttpException errors.
    // The test still asserts the user-facing response shape; the log is incidental.
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    req = { method: 'POST', url: '/api/v1/test' };
  });

  it('formats HttpException as RFC 7807 with status + title + detail', () => {
    const exception = new BadRequestException('Invalid input');
    filter.catch(exception, buildHost(req, res));

    expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: expect.stringContaining('/400'),
        title: 'BAD_REQUEST',
        status: 400,
        detail: 'Invalid input',
        instance: '/api/v1/test',
        timestamp: expect.any(String),
      }),
    );
  });

  it('preserves validation errors array from class-validator', () => {
    const exception = new BadRequestException({
      message: 'Validation failed',
      errors: ['email must be valid'],
    });
    filter.catch(exception, buildHost(req, res));

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        errors: ['email must be valid'],
      }),
    );
  });

  it('returns 500 generic for unknown errors (no stack leakage)', () => {
    const exception = new Error(
      'Internal DB error: connection string is "postgres://..."',
    );
    filter.catch(exception, buildHost(req, res));

    expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = res.json.mock.calls[0][0] as Record<string, unknown>;
    expect(body.status).toBe(500);
    expect(body.detail).toBe('An unexpected error occurred');
    // Must not leak the real error message
    expect(JSON.stringify(body)).not.toContain('connection string');
  });

  it('handles HttpException with string response body', () => {
    class CustomException extends HttpException {
      constructor() {
        super('Custom message', 418);
      }
    }
    filter.catch(new CustomException(), buildHost(req, res));
    expect(res.status).toHaveBeenCalledWith(418);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ detail: 'Custom message' }),
    );
  });
});
