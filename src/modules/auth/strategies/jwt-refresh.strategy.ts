import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { RefreshTokenPayload } from '../types';

export interface RefreshContext {
  payload: RefreshTokenPayload;
  rawToken: string;
}

/**
 * Validates the refresh JWT carried in the `refreshToken` HttpOnly cookie.
 *
 * Returns BOTH the parsed payload and the raw token string, so the service
 * layer can bcrypt-compare it against the hashed copy in `refresh_tokens`.
 */
@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(config: ConfigService) {
    const secret = config.get<string>('JWT_REFRESH_SECRET');
    if (!secret) {
      throw new Error('JWT_REFRESH_SECRET is not configured');
    }
    super({
      jwtFromRequest: (req: Request) => {
        const cookieToken = (req?.cookies as Record<string, string> | undefined)
          ?.refreshToken;
        return cookieToken ?? null;
      },
      ignoreExpiration: false,
      secretOrKey: secret,
      passReqToCallback: true,
    });
  }

  validate(req: Request, payload: RefreshTokenPayload): RefreshContext {
    if (!payload?.sub || !payload?.type || typeof payload.jti !== 'number') {
      throw new UnauthorizedException('Invalid refresh token payload');
    }
    const rawToken = (req?.cookies as Record<string, string> | undefined)
      ?.refreshToken;
    if (!rawToken) {
      throw new UnauthorizedException('Missing refresh token');
    }
    return { payload, rawToken };
  }
}
