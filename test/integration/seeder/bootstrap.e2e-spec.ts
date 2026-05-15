import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { buildTestApp } from '../helpers/app';
import { truncateAll, countRows, findOne } from '../helpers/db';
import { http } from '../helpers/http';
import { resetCounters } from '../helpers/fixtures';
import { SeederService } from '../../../src/modules/seeder/seeder.service';

/**
 * Verifies the SeederService runs on application bootstrap, creates exactly
 * one super_admin, is idempotent across restarts, and produces an account
 * that can actually log in.
 */
describe('[integration] seeder/bootstrap', () => {
  let app: INestApplication;
  let ds: DataSource;
  let seeder: SeederService;

  beforeAll(async () => {
    app = await buildTestApp();
    ds = app.get(DataSource);
    seeder = app.get(SeederService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(ds);
    resetCounters();
  });

  it('creates exactly one super_admin row on bootstrap', async () => {
    await seeder.onApplicationBootstrap();

    expect(await countRows(ds, 'admin_users')).toBe(1);

    const admin = await findOne<{
      id: string;
      email: string;
      role: string;
      active: boolean;
      first_name: string;
      last_name: string;
    }>(ds, 'admin_users', { role: 'super_admin' });

    expect(admin).not.toBeNull();
    expect(admin!.email).toBe('admin@ios.local');
    expect(admin!.role).toBe('super_admin');
    expect(admin!.active).toBe(true);
    expect(admin!.first_name).toBe('IOS');
    expect(admin!.last_name).toBe('Admin');
    expect(admin!.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('is idempotent: re-running the seeder does not create a second row', async () => {
    await seeder.onApplicationBootstrap();
    expect(await countRows(ds, 'admin_users')).toBe(1);

    await seeder.onApplicationBootstrap();
    expect(await countRows(ds, 'admin_users')).toBe(1);

    await seeder.onApplicationBootstrap();
    expect(await countRows(ds, 'admin_users')).toBe(1);
  });

  it('the bootstrapped super_admin can log in via /auth/admin/login', async () => {
    await seeder.onApplicationBootstrap();

    const res = await http(app)
      .post('/api/v1/auth/admin/login')
      .send({ email: 'admin@ios.local', password: 'DevAdmin@123!' })
      .expect(200);

    const body = res.body as {
      accessToken: string;
      user: { email: string; role: string; type: string };
    };
    expect(body.accessToken).toBeTruthy();
    expect(body.user.email).toBe('admin@ios.local');
    expect(body.user.role).toBe('super_admin');
    expect(body.user.type).toBe('admin');
  });

  it('the protect_super_admin_role trigger still blocks deletion of the bootstrapped row', async () => {
    await seeder.onApplicationBootstrap();

    const admin = await findOne<{ id: string }>(ds, 'admin_users', {
      role: 'super_admin',
    });
    expect(admin).not.toBeNull();

    await expect(
      ds.query(`DELETE FROM admin_users WHERE id = $1`, [admin!.id]),
    ).rejects.toThrow(/super_admin/);

    expect(await countRows(ds, 'admin_users')).toBe(1);
  });
});
