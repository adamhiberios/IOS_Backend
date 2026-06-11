import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminRole } from '../../database/entities';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Authorization is EXACT-MATCH against the roles listed in @Roles(), with one
 * exception: SUPER_ADMIN passes every check.
 *
 * The previous numeric-level hierarchy put FINANCE_ADMIN and CONTENT_CREATOR
 * on the same level with a >= comparison, which gave finance admins content-
 * creation powers — violating the 5-tier branch separation (H7, audit
 * 2026-06-11). Every controller already lists its allowed roles explicitly
 * (e.g. @Roles(CONTENT_CREATOR, LEARNING_ADMIN)), so no route relied on the
 * implicit hierarchy.
 */

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<AdminRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no @Roles() decorator is present, route is publicly guarded by JwtAuthGuard only
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<{
      user?: { role?: AdminRole };
    }>();

    if (!user?.role) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const hasPermission =
      user.role === AdminRole.SUPER_ADMIN ||
      requiredRoles.includes(user.role);

    if (!hasPermission) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
