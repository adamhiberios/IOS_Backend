import { Repository } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { User } from '../../database/entities';
import { ProfileService } from './profile.service';

function makeUser(overrides: Partial<User> = {}): User {
  const u = new User();
  u.id = '11111111-1111-1111-1111-111111111111';
  u.email = 'student@example.com';
  u.passwordHash = 'hash';
  u.firstName = 'Jane';
  u.lastName = 'Doe';
  u.phone = null;
  u.avatarUrl = null;
  u.country = null;
  u.city = null;
  u.street = null;
  u.address = null;
  u.postalCode = null;
  u.occupation = null;
  u.position = null;
  u.company = null;
  u.locale = 'en';
  u.emailVerified = true;
  u.active = true;
  u.createdAt = new Date('2026-05-19T08:00:00Z');
  u.updatedAt = new Date('2026-05-19T08:00:00Z');
  Object.assign(u, overrides);
  return u;
}

describe('ProfileService', () => {
  let users: jest.Mocked<Pick<Repository<User>, 'findOne' | 'findOneOrFail' | 'update'>>;
  let svc: ProfileService;

  beforeEach(() => {
    users = {
      findOne: jest.fn(),
      findOneOrFail: jest.fn(),
      update: jest.fn(),
    } as never;
    svc = new ProfileService(users as unknown as Repository<User>);
  });

  describe('getProfile', () => {
    it('returns the profile with fullName + direction', async () => {
      users.findOne.mockResolvedValue(makeUser({ locale: 'tr' }));
      const out = await svc.getProfile('11111111-1111-1111-1111-111111111111');
      expect(out.email).toBe('student@example.com');
      expect(out.fullName).toBe('Jane Doe');
      expect(out.locale).toBe('tr');
      expect(out.direction).toBe('ltr');
    });

    it('reports rtl direction for Arabic locale', async () => {
      users.findOne.mockResolvedValue(makeUser({ locale: 'ar' }));
      const out = await svc.getProfile('11111111-1111-1111-1111-111111111111');
      expect(out.direction).toBe('rtl');
    });

    it('coerces an unsupported stored locale to en', async () => {
      users.findOne.mockResolvedValue(makeUser({ locale: 'ja' }));
      const out = await svc.getProfile('11111111-1111-1111-1111-111111111111');
      expect(out.locale).toBe('en');
      expect(out.direction).toBe('ltr');
    });

    it('throws 404 when the user row is gone', async () => {
      users.findOne.mockResolvedValue(null);
      await expect(svc.getProfile('00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('updateProfile', () => {
    it('applies only allowlisted fields', async () => {
      users.findOne.mockResolvedValue(makeUser());
      users.findOneOrFail.mockResolvedValue(
        makeUser({ firstName: 'Janet', city: 'Toronto' }),
      );
      users.update.mockResolvedValue({} as never);

      // @ts-expect-error — passing a forbidden field at runtime to assert filtering
      await svc.updateProfile('11111111-1111-1111-1111-111111111111', {
        firstName: 'Janet',
        city: 'Toronto',
        email: 'attacker@evil.com', // must be dropped
        emailVerified: false, // must be dropped
        passwordHash: 'pwned', // must be dropped
      });

      expect(users.update).toHaveBeenCalledTimes(1);
      const [, patch] = users.update.mock.calls[0];
      expect(patch).toEqual({ firstName: 'Janet', city: 'Toronto' });
      expect(patch).not.toHaveProperty('email');
      expect(patch).not.toHaveProperty('emailVerified');
      expect(patch).not.toHaveProperty('passwordHash');
    });

    it('treats explicit null as clear, undefined as no-op', async () => {
      users.findOne.mockResolvedValue(makeUser({ phone: '+1' }));
      users.findOneOrFail.mockResolvedValue(makeUser({ phone: null }));
      users.update.mockResolvedValue({} as never);

      await svc.updateProfile('11111111-1111-1111-1111-111111111111', {
        phone: null,
      });

      const [, patch] = users.update.mock.calls[0];
      expect(patch).toEqual({ phone: null });
    });

    it('returns current state without touching DB when patch is empty', async () => {
      users.findOne.mockResolvedValue(makeUser());
      const out = await svc.updateProfile('11111111-1111-1111-1111-111111111111', {});
      expect(users.update).not.toHaveBeenCalled();
      expect(out.email).toBe('student@example.com');
    });

    it('throws 404 when the user is gone before update', async () => {
      users.findOne.mockResolvedValue(null);
      await expect(
        svc.updateProfile('00000000-0000-0000-0000-000000000000', { firstName: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
