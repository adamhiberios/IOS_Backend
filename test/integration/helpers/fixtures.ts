import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, AdminUser, AdminRole } from '../../../src/database/entities';

let _userCounter = 0;
let _adminCounter = 0;

/**
 * Resets fixture counters between tests so emails stay deterministic.
 */
export function resetCounters(): void {
  _userCounter = 0;
  _adminCounter = 0;
}

export interface CreateUserOptions {
  email?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  emailVerified?: boolean;
  active?: boolean;
  locale?: string;
}

export interface CreatedUser {
  id: string;
  email: string;
  password: string; // plain — for login in tests
  firstName: string;
  lastName: string;
}

/**
 * Creates a verified, active student user. Returns the plain password too
 * so the test can sign in via the HTTP API.
 *
 * Default password "TestP@ssw0rd1" meets our complexity rule.
 */
export async function createUser(
  app: INestApplication,
  opts: CreateUserOptions = {},
): Promise<CreatedUser> {
  const ds = app.get(DataSource);
  const repo = ds.getRepository(User);

  _userCounter += 1;
  const email = opts.email ?? `student-${_userCounter}@example.com`;
  const password = opts.password ?? 'TestP@ssw0rd1';
  const firstName = opts.firstName ?? `Student${_userCounter}`;
  const lastName = opts.lastName ?? 'Test';

  // bcrypt cost 4 in tests — same hashing flow, but ~50x faster than cost 12
  const passwordHash = await bcrypt.hash(password, 4);

  const user = await repo.save(
    repo.create({
      email,
      passwordHash,
      firstName,
      lastName,
      locale: opts.locale ?? 'en',
      emailVerified: opts.emailVerified ?? true,
      emailVerifiedAt: opts.emailVerified === false ? null : new Date(),
      active: opts.active ?? true,
    }),
  );

  return { id: user.id, email, password, firstName, lastName };
}

export interface CreateAdminOptions {
  email?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  role?: AdminRole;
  active?: boolean;
}

export interface CreatedAdmin extends CreatedUser {
  role: AdminRole;
}

export async function createAdmin(
  app: INestApplication,
  opts: CreateAdminOptions = {},
): Promise<CreatedAdmin> {
  const ds = app.get(DataSource);
  const repo = ds.getRepository(AdminUser);

  _adminCounter += 1;
  const email = opts.email ?? `admin-${_adminCounter}@example.com`;
  const password = opts.password ?? 'AdminP@ss1';
  const firstName = opts.firstName ?? `Admin${_adminCounter}`;
  const lastName = opts.lastName ?? 'Staff';
  const role = opts.role ?? AdminRole.LEARNING_ADMIN;

  const passwordHash = await bcrypt.hash(password, 4);

  const admin = await repo.save(
    repo.create({
      email,
      passwordHash,
      firstName,
      lastName,
      role,
      active: opts.active ?? true,
    }),
  );

  return { id: admin.id, email, password, firstName, lastName, role };
}
