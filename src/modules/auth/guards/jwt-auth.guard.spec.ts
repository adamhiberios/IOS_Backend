import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../decorators';

const buildContext = (): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({}),
      getResponse: () => ({}),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  }) as unknown as ExecutionContext;

describe('JwtAuthGuard', () => {
  it('bypasses authentication when @Public() metadata is set', () => {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) => {
        if (key === IS_PUBLIC_KEY) return true;
        return undefined;
      }),
    } as unknown as Reflector;

    const guard = new JwtAuthGuard(reflector);
    expect(guard.canActivate(buildContext())).toBe(true);
  });

  it('delegates to Passport AuthGuard when @Public() is not set', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    } as unknown as Reflector;

    const guard = new JwtAuthGuard(reflector);
    // The Passport guard will attempt JWT validation; we patch its super.canActivate
    const superSpy = jest
      .spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate')
      .mockReturnValue(true);

    expect(guard.canActivate(buildContext())).toBe(true);
    expect(superSpy).toHaveBeenCalled();

    superSpy.mockRestore();
  });
});
