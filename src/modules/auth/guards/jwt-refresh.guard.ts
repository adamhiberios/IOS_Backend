import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Applied only to /auth/refresh routes. Validates the refresh JWT from
 * the HttpOnly cookie. Attaches { payload, rawToken } to req.user (via Passport).
 */
@Injectable()
export class JwtRefreshGuard extends AuthGuard('jwt-refresh') {}
