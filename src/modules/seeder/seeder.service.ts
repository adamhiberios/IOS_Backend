import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';

import { AdminUser, AdminRole } from '../../database/entities';

/**
 * Bootstraps a super_admin row on application startup if one does not exist.
 *
 * Behaviour is gated by NODE_ENV:
 *
 *  - development / test:
 *      Always runs. Uses BOOTSTRAP_SUPER_ADMIN_* env vars when set,
 *      otherwise falls back to dev defaults with a loud warning.
 *
 *  - staging:
 *      Always runs. BOOTSTRAP_SUPER_ADMIN_EMAIL + _PASSWORD are REQUIRED.
 *      Refuses to start the app if either is missing.
 *
 *  - production:
 *      Opt-in only. Requires BOOTSTRAP_SUPER_ADMIN=true AND
 *      BOOTSTRAP_SUPER_ADMIN_EMAIL + _PASSWORD. If the opt-in flag is
 *      absent the seeder is a no-op, period. This makes the standard
 *      production deploy behaviour "do nothing" — bootstrap is a deliberate
 *      one-time act performed by ops on first launch.
 *
 * Race safety:
 *   Two workers can boot simultaneously (PM2 cluster mode runs 2 workers).
 *   We guard with: (1) row count check before INSERT, (2) ON CONFLICT
 *   DO NOTHING on the unique (email) constraint. At most one row wins.
 *
 * Idempotency:
 *   The seeder counts existing super_admin rows. If any exist, it's a no-op
 *   regardless of what env vars say. This is intentional — we never want to
 *   create a second super_admin, and we never want to mutate an existing
 *   one (the protect_super_admin_role DB trigger would block that anyway).
 */
@Injectable()
export class SeederService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeederService.name);

  // Dev-only defaults. Loud warning logged if these are used. Never
  // suitable for staging/production.
  private static readonly DEV_DEFAULTS = {
    email: 'admin@ios.local',
    password: 'DevAdmin@123!',
    firstName: 'IOS',
    lastName: 'Admin',
  };

  constructor(
    @InjectRepository(AdminUser)
    private readonly admins: Repository<AdminUser>,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const env = this.config.get<string>('NODE_ENV', 'development');
    const optedIn = this.config.get<string>('BOOTSTRAP_SUPER_ADMIN') === 'true';

    // 1. Production safety gate — opt-in only.
    if (env === 'production' && !optedIn) {
      this.logger.log(
        'super_admin bootstrap skipped (production requires BOOTSTRAP_SUPER_ADMIN=true)',
      );
      return;
    }

    // 2. Idempotency check.
    const existing = await this.admins.count({
      where: { role: AdminRole.SUPER_ADMIN },
    });
    if (existing > 0) {
      this.logger.log(
        `super_admin already exists (count=${existing}), bootstrap skipped`,
      );
      return;
    }

    // 3. Resolve credentials from env, applying per-env policy.
    const creds = this.resolveCredentials(env);

    // 4. Create the row. ON CONFLICT DO NOTHING handles the race where a
    //    sibling worker beat us between the count check and the insert.
    const passwordHash = await bcrypt.hash(creds.password, 12);

    const result = await this.admins
      .createQueryBuilder()
      .insert()
      .into(AdminUser)
      .values({
        email: creds.email,
        passwordHash,
        firstName: creds.firstName,
        lastName: creds.lastName,
        role: AdminRole.SUPER_ADMIN,
        active: true,
      })
      .orIgnore() // ON CONFLICT DO NOTHING
      .execute();

    const inserted = result.identifiers.length > 0;
    if (inserted) {
      this.logger.warn(
        `Bootstrapped super_admin <${creds.email}> on ${env}. ` +
          `Change the password immediately if you used dev defaults.`,
      );
    } else {
      this.logger.log(
        `super_admin INSERT raced against another worker — already exists, skipping`,
      );
    }
  }

  /**
   * Reads bootstrap credentials from env, enforcing per-environment rules.
   * Throws (and prevents the app from starting) if required env vars are
   * missing in staging or production.
   */
  private resolveCredentials(env: string): {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  } {
    const email = this.config.get<string>('BOOTSTRAP_SUPER_ADMIN_EMAIL');
    const password = this.config.get<string>('BOOTSTRAP_SUPER_ADMIN_PASSWORD');
    const firstName = this.config.get<string>(
      'BOOTSTRAP_SUPER_ADMIN_FIRST_NAME',
    );
    const lastName = this.config.get<string>('BOOTSTRAP_SUPER_ADMIN_LAST_NAME');

    if (env === 'staging' || env === 'production') {
      if (!email || !password) {
        throw new InternalServerErrorException(
          `Refusing to bootstrap super_admin on ${env} without ` +
            `BOOTSTRAP_SUPER_ADMIN_EMAIL and BOOTSTRAP_SUPER_ADMIN_PASSWORD env vars.`,
        );
      }
      if (!firstName || !lastName) {
        throw new InternalServerErrorException(
          `Refusing to bootstrap super_admin on ${env} without ` +
            `BOOTSTRAP_SUPER_ADMIN_FIRST_NAME and BOOTSTRAP_SUPER_ADMIN_LAST_NAME env vars.`,
        );
      }
      return { email, password, firstName, lastName };
    }

    // development / test — env vars optional, fall back to dev defaults
    const usingDefaults = !email || !password;
    if (usingDefaults) {
      this.logger.warn(
        `Using DEV DEFAULTS for super_admin bootstrap (email=${SeederService.DEV_DEFAULTS.email}). ` +
          `Set BOOTSTRAP_SUPER_ADMIN_* env vars to override. ` +
          `These defaults must NEVER be used outside local development.`,
      );
    }
    return {
      email: email ?? SeederService.DEV_DEFAULTS.email,
      password: password ?? SeederService.DEV_DEFAULTS.password,
      firstName: firstName ?? SeederService.DEV_DEFAULTS.firstName,
      lastName: lastName ?? SeederService.DEV_DEFAULTS.lastName,
    };
  }
}
