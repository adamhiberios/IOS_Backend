import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AccessTokenPayload } from '../types';
import { AuthenticatedUser } from '../../../common/interceptors/rls.interceptor';

/**
 * Validates the access JWT carried in `Authorization: Bearer <token>` header.
 * On success, attaches the user (in our shape) to req.user.
 * On expired/invalid token, returns 401.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    const secret = config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET is not configured');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  validate(payload: AccessTokenPayload): AuthenticatedUser {
    if (!payload?.sub || !payload?.type) {
      throw new UnauthorizedException('Invalid token payload');
    }

    if (payload.type === 'admin') {
      return {
        adminId: payload.sub,
        type: 'admin',
        email: payload.email,
        role: payload.role,
        locale: payload.locale,
      };
    }

    return {
      id: payload.sub,
      type: 'student',
      email: payload.email,
      locale: payload.locale,
    };
  }
}
