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
 * Role hierarchy — higher index = more permissive.
 * A role can perform any action at its level or below.
 */
const ROLE_HIERARCHY: Record<AdminRole, number> = {
  [AdminRole.SUPER_ADMIN]: 5,
  [AdminRole.LEARNING_ADMIN]: 4,
  [AdminRole.CONTENT_CREATOR]: 2,
  [AdminRole.FINANCE_ADMIN]: 2,
  [AdminRole.SUPPORT_ADMIN]: 1,
};

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

    const userLevel = ROLE_HIERARCHY[user.role] ?? 0;
    const hasPermission = requiredRoles.some((role) => {
      const requiredLevel = ROLE_HIERARCHY[role] ?? 0;
      return userLevel >= requiredLevel;
    });

    if (!hasPermission) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
