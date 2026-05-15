import {
  SetMetadata,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import { AuthenticatedUser } from '../../../common/interceptors/rls.interceptor';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as public — JwtAuthGuard skips authentication.
 * Use sparingly: login, register, verify-email, forgot/reset password, public verify cert.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Injects the authenticated user (or a property of it) into a controller method.
 *
 * @example
 *   @Get('me')
 *   profile(@CurrentUser() user: AuthenticatedUser) { ... }
 *
 *   @Get('me/id')
 *   id(@CurrentUser('id') userId: number) { ... }
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);
