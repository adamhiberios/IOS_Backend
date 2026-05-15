import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { AdminRole } from '../../database/entities';

const buildContext = (
  user: { role?: AdminRole } | undefined,
): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  }) as unknown as ExecutionContext;

const buildReflector = (requiredRoles: AdminRole[] | undefined): Reflector =>
  ({
    getAllAndOverride: jest.fn().mockReturnValue(requiredRoles),
  }) as unknown as Reflector;

describe('RolesGuard', () => {
  it('allows routes without @Roles() decorator', () => {
    const guard = new RolesGuard(buildReflector(undefined));
    expect(
      guard.canActivate(buildContext({ role: AdminRole.SUPPORT_ADMIN })),
    ).toBe(true);
  });

  it('allows routes with empty @Roles() array', () => {
    const guard = new RolesGuard(buildReflector([]));
    expect(
      guard.canActivate(buildContext({ role: AdminRole.SUPPORT_ADMIN })),
    ).toBe(true);
  });

  it('denies request with no user attached', () => {
    const guard = new RolesGuard(buildReflector([AdminRole.LEARNING_ADMIN]));
    expect(() => guard.canActivate(buildContext(undefined))).toThrow(
      ForbiddenException,
    );
  });

  it('denies request when user has no role claim', () => {
    const guard = new RolesGuard(buildReflector([AdminRole.LEARNING_ADMIN]));
    expect(() => guard.canActivate(buildContext({}))).toThrow(
      ForbiddenException,
    );
  });

  it('super_admin can access learning_admin-required routes', () => {
    const guard = new RolesGuard(buildReflector([AdminRole.LEARNING_ADMIN]));
    expect(
      guard.canActivate(buildContext({ role: AdminRole.SUPER_ADMIN })),
    ).toBe(true);
  });

  it('support_admin cannot access learning_admin-required routes', () => {
    const guard = new RolesGuard(buildReflector([AdminRole.LEARNING_ADMIN]));
    expect(() =>
      guard.canActivate(buildContext({ role: AdminRole.SUPPORT_ADMIN })),
    ).toThrow(ForbiddenException);
  });

  it('content_creator can access content_creator-required routes', () => {
    const guard = new RolesGuard(buildReflector([AdminRole.CONTENT_CREATOR]));
    expect(
      guard.canActivate(buildContext({ role: AdminRole.CONTENT_CREATOR })),
    ).toBe(true);
  });

  it('finance_admin cannot access learning_admin-required routes (same tier but different scope)', () => {
    // finance_admin and content_creator share tier 2 numerically, both < tier 4
    const guard = new RolesGuard(buildReflector([AdminRole.LEARNING_ADMIN]));
    expect(() =>
      guard.canActivate(buildContext({ role: AdminRole.FINANCE_ADMIN })),
    ).toThrow(ForbiddenException);
  });

  it('allows route when user has any one of multiple required roles', () => {
    const guard = new RolesGuard(
      buildReflector([AdminRole.LEARNING_ADMIN, AdminRole.CONTENT_CREATOR]),
    );
    expect(
      guard.canActivate(buildContext({ role: AdminRole.CONTENT_CREATOR })),
    ).toBe(true);
  });
});
