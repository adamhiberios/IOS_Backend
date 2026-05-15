import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { DataSource } from 'typeorm';
import { AppModule } from '../../../src/app.module';
import { GlobalExceptionFilter } from '../../../src/common/filters/global-exception.filter';

export interface BuildTestAppOptions {
  /**
   * Hook to apply further overrides on the TestingModuleBuilder before compile.
   * Use for swapping providers (MailService → MailSpy, etc.).
   */
  customize?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

/**
 * Boots a full NestJS application connected to the test database.
 *
 * Configuration mirrors src/main.ts as closely as possible — same pipes,
 * same filters, same middleware — so requests behave like production.
 *
 * Note on throttling: AppModule reads NODE_ENV at construction time and uses
 * a very high limit when NODE_ENV=test (set by setup.ts), so tests don't
 * accidentally trip the rate limiter. The throttler-specific integration
 * test builds its own TestingModule with the real production limits.
 */
export async function buildTestApp(
  optsOrCustomize?:
    | BuildTestAppOptions
    | ((builder: TestingModuleBuilder) => TestingModuleBuilder),
): Promise<INestApplication> {
  const opts: BuildTestAppOptions =
    typeof optsOrCustomize === 'function'
      ? { customize: optsOrCustomize }
      : (optsOrCustomize ?? {});

  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (opts.customize) {
    builder = opts.customize(builder);
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();

  // Mirror main.ts setup
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());

  await app.init();
  return app;
}

/**
 * Pulls the live DataSource out of the Nest container — useful for tests
 * that need to truncate, seed, or peek at the DB directly.
 */
export function getDataSource(app: INestApplication): DataSource {
  return app.get(DataSource);
}
