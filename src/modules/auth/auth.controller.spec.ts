import { Test, TestingModule } from '@nestjs/testing';
import type { Response, Request } from 'express';
import { Reflector } from '@nestjs/core';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { RefreshContext } from './strategies/jwt-refresh.strategy';

const USER_UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('AuthController', () => {
  let controller: AuthController;
  let auth: jest.Mocked<AuthService>;

  const buildRes = (): jest.Mocked<Response> => {
    return {
      cookie: jest.fn().mockReturnThis(),
      clearCookie: jest.fn().mockReturnThis(),
    } as unknown as jest.Mocked<Response>;
  };

  beforeEach(async () => {
    auth = {
      register: jest.fn(),
      verifyEmail: jest.fn(),
      loginStudent: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
      forgotPassword: jest.fn(),
      resetPassword: jest.fn(),
    } as unknown as jest.Mocked<AuthService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: auth }, Reflector],
    })
      .overrideGuard(JwtRefreshGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('register', () => {
    it('delegates to authService and returns its result', async () => {
      auth.register.mockResolvedValue({ userId: USER_UUID, message: 'ok' });
      const result = await controller.register({
        email: 'x@y.com',
        password: 'StrongP@ss1',
        firstName: 'X',
        lastName: 'Y',
      });
      expect(result).toEqual({ userId: USER_UUID, message: 'ok' });
      expect(auth.register).toHaveBeenCalled();
    });
  });

  describe('verifyEmail', () => {
    it('passes the token through to the service', async () => {
      auth.verifyEmail.mockResolvedValue({ message: 'verified' });
      await controller.verifyEmail({ token: 'a'.repeat(32) });
      expect(auth.verifyEmail).toHaveBeenCalledWith('a'.repeat(32));
    });
  });

  describe('login', () => {
    it('sets refresh cookie with HttpOnly + Lax + scoped path', async () => {
      auth.loginStudent.mockResolvedValue({
        login: {
          accessToken: 'access.jwt',
          expiresIn: 900,
          user: {
            id: USER_UUID,
            email: 'a@b.com',
            firstName: 'A',
            lastName: 'B',
            fullName: 'A B',
            locale: 'en',
            emailVerified: true,
            type: 'student',
            role: null,
          },
        },
        refreshToken: 'refresh.jwt',
      });
      const res = buildRes();

      await controller.login({ email: 'a@b.com', password: 'P@ss1' }, res);

      expect(res.cookie).toHaveBeenCalledWith(
        'refreshToken',
        'refresh.jwt',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          path: '/api/v1/auth',
        }),
      );
    });

    it('refresh cookie maxAge equals 7 days in milliseconds', async () => {
      auth.loginStudent.mockResolvedValue({
        login: {
          accessToken: 'a',
          expiresIn: 900,
          user: {
            id: USER_UUID,
            email: 'a@b.com',
            firstName: 'A',
            lastName: 'B',
            fullName: 'A B',
            locale: 'en',
            emailVerified: true,
            type: 'student',
            role: null,
          },
        },
        refreshToken: 'r',
      });
      const res = buildRes();
      await controller.login({ email: 'a@b.com', password: 'P@ss1' }, res);

      const cookieOpts = (res.cookie as jest.Mock).mock.calls[0][2] as {
        maxAge: number;
      };
      expect(cookieOpts.maxAge).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it('does NOT expose the refresh token in the response body', async () => {
      auth.loginStudent.mockResolvedValue({
        login: {
          accessToken: 'a',
          expiresIn: 900,
          user: {
            id: USER_UUID,
            email: 'a@b.com',
            firstName: 'A',
            lastName: 'B',
            fullName: 'A B',
            locale: 'en',
            emailVerified: true,
            type: 'student',
            role: null,
          },
        },
        refreshToken: 'should-stay-in-cookie',
      });
      const res = buildRes();
      const result = await controller.login(
        { email: 'a@b.com', password: 'P@ss1' },
        res,
      );

      // The response body only contains LoginResponseDto — no refreshToken key
      expect(result).not.toHaveProperty('refreshToken');
      expect(JSON.stringify(result)).not.toContain('should-stay-in-cookie');
    });
  });

  describe('refresh', () => {
    it('rotates and sets a new cookie', async () => {
      auth.refresh.mockResolvedValue({
        login: {
          accessToken: 'new.access',
          expiresIn: 900,
          user: {
            id: USER_UUID,
            email: 'a@b.com',
            firstName: 'A',
            lastName: 'B',
            fullName: 'A B',
            locale: 'en',
            emailVerified: true,
            type: 'student',
            role: null,
          },
        },
        refreshToken: 'new.refresh',
      });
      const res = buildRes();
      const req = {
        user: {
          payload: { sub: USER_UUID, type: 'student', jti: 1 },
          rawToken: 'old',
        } as RefreshContext,
      } as unknown as Request & { user: RefreshContext };

      await controller.refresh(req, res);

      expect(auth.refresh).toHaveBeenCalledWith(
        { sub: USER_UUID, type: 'student', jti: 1 },
        'old',
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'refreshToken',
        'new.refresh',
        expect.objectContaining({ httpOnly: true }),
      );
    });
  });

  describe('logout', () => {
    it('revokes the token and clears the cookie', async () => {
      auth.logout.mockResolvedValue({ message: 'Logged out' });
      const res = buildRes();
      const req = {
        user: {
          payload: { sub: USER_UUID, type: 'student', jti: 1 },
          rawToken: 'r',
        } as RefreshContext,
      } as unknown as Request & { user: RefreshContext };

      const result = await controller.logout(req, res);

      expect(result).toEqual({ message: 'Logged out' });
      expect(res.clearCookie).toHaveBeenCalledWith('refreshToken', {
        path: '/api/v1/auth',
      });
    });
  });

  describe('forgot-password and reset-password', () => {
    it('forgotPassword passes email to service', async () => {
      auth.forgotPassword.mockResolvedValue({ message: 'ok' });
      await controller.forgotPassword({ email: 'a@b.com' });
      expect(auth.forgotPassword).toHaveBeenCalledWith('a@b.com');
    });

    it('resetPassword passes token and new password', async () => {
      auth.resetPassword.mockResolvedValue({ message: 'ok' });
      await controller.resetPassword({
        token: 'a'.repeat(32),
        newPassword: 'NewP@ss1',
      });
      expect(auth.resetPassword).toHaveBeenCalledWith(
        'a'.repeat(32),
        'NewP@ss1',
      );
    });
  });
});
