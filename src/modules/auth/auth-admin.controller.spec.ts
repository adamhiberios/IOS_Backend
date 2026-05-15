import { Test, TestingModule } from '@nestjs/testing';
import type { Response, Request } from 'express';
import { Reflector } from '@nestjs/core';

import { AuthAdminController } from './auth-admin.controller';
import { AuthService } from './auth.service';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { RefreshContext } from './strategies/jwt-refresh.strategy';
import { AdminRole } from '../../database/entities';

const ADMIN_UUID = '66e8400e-e29b-41d4-a716-446655440001';

describe('AuthAdminController', () => {
  let controller: AuthAdminController;
  let auth: jest.Mocked<AuthService>;

  const buildRes = (): jest.Mocked<Response> =>
    ({
      cookie: jest.fn().mockReturnThis(),
      clearCookie: jest.fn().mockReturnThis(),
    }) as unknown as jest.Mocked<Response>;

  beforeEach(async () => {
    auth = {
      loginAdmin: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
    } as unknown as jest.Mocked<AuthService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthAdminController],
      providers: [{ provide: AuthService, useValue: auth }, Reflector],
    })
      .overrideGuard(JwtRefreshGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthAdminController>(AuthAdminController);
  });

  it('login delegates to loginAdmin and sets cookie', async () => {
    auth.loginAdmin.mockResolvedValue({
      login: {
        accessToken: 'a',
        expiresIn: 900,
        user: {
          id: ADMIN_UUID,
          email: 'admin@example.com',
          firstName: 'Admin',
          lastName: 'User',
          fullName: 'Admin User',
          locale: 'en',
          emailVerified: true,
          type: 'admin',
          role: AdminRole.SUPER_ADMIN,
        },
      },
      refreshToken: 'r',
    });

    const res = buildRes();
    const result = await controller.login(
      { email: 'admin@example.com', password: 'P@ss1' },
      res,
    );

    expect(result.user.type).toBe('admin');
    expect(result.user.role).toBe(AdminRole.SUPER_ADMIN);
    expect(res.cookie).toHaveBeenCalledWith(
      'refreshToken',
      'r',
      expect.objectContaining({ httpOnly: true, path: '/api/v1/auth' }),
    );
  });

  it('logout clears cookie', async () => {
    auth.logout.mockResolvedValue({ message: 'Logged out' });
    const res = buildRes();
    const req = {
      user: {
        payload: { sub: ADMIN_UUID, type: 'admin', jti: 1 },
        rawToken: 'r',
      } as RefreshContext,
    } as unknown as Request & { user: RefreshContext };

    await controller.logout(req, res);
    expect(res.clearCookie).toHaveBeenCalled();
  });

  it('refresh rotates admin session', async () => {
    auth.refresh.mockResolvedValue({
      login: {
        accessToken: 'new.a',
        expiresIn: 900,
        user: {
          id: ADMIN_UUID,
          email: 'admin@example.com',
          firstName: 'Admin',
          lastName: 'User',
          fullName: 'Admin User',
          locale: 'en',
          emailVerified: true,
          type: 'admin',
          role: AdminRole.SUPER_ADMIN,
        },
      },
      refreshToken: 'new.r',
    });
    const res = buildRes();
    const req = {
      user: {
        payload: { sub: ADMIN_UUID, type: 'admin', jti: 1 },
        rawToken: 'old',
      } as RefreshContext,
    } as unknown as Request & { user: RefreshContext };

    await controller.refresh(req, res);
    expect(auth.refresh).toHaveBeenCalledWith(
      { sub: ADMIN_UUID, type: 'admin', jti: 1 },
      'old',
    );
  });
});
