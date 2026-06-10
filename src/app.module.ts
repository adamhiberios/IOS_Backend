import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';

import { validationSchema } from './config/validation';
import { typeormConfig } from './database/config/typeorm.config';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { RlsInterceptor } from './common/interceptors/rls.interceptor';

import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { SeederModule } from './modules/seeder/seeder.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { AppI18nModule } from './i18n/i18n.module';
import { StorageModule } from './modules/storage/storage.module';
import { ProfileModule } from './modules/profile/profile.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { LearningModule } from './modules/learning/learning.module';
import { RedisModule } from './modules/redis/redis.module';
import { ExamModule } from './modules/exam/exam.module';
import { WebModule } from './modules/web/web.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema,
      validationOptions: { abortEarly: false },
    }),
    TypeOrmModule.forRootAsync({
      useFactory: typeormConfig,
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        // In test env we set this very high so individual tests don't trip
        // the limiter as a side-effect. The throttler-specific integration
        // test re-asserts the real behaviour by overriding the limit locally.
        limit: process.env.NODE_ENV === 'test' ? 100_000 : 100,
      },
      {
        name: 'auth',
        ttl: 60_000,
        limit: process.env.NODE_ENV === 'test' ? 100_000 : 5,
      },
    ]),
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      maxListeners: 20,
      verboseMemoryLeak: true,
      ignoreErrors: false,
    }),

    // i18n must load before feature modules so injected I18nService is ready
    AppI18nModule,

    // StorageModule is @Global() — exposes StorageService to every feature
    // module without per-module import boilerplate.
    StorageModule,

    // RedisModule is @Global() — exposes RedisService and REDIS_CLIENT/SUBSCRIBER
    // tokens to every feature module (exam engine, future queuing, etc.).
    RedisModule,

    // Feature modules
    HealthModule,
    AuthModule,
    SeederModule,
    ProfileModule,
    CatalogModule,
    LearningModule,
    ExamModule,
    WebModule,
  ],
  providers: [
    // Global error handler (RFC 7807)
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },

    // Global validation pipe — applies to every DTO automatically
    {
      provide: APP_PIPE,
      useFactory: () =>
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          transformOptions: { enableImplicitConversion: true },
        }),
    },

    // GLOBAL GUARDS — order matters: throttler first (cheaper), then JWT.
    // Routes opt out of JWT via @Public(). Throttler runs on every request.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },

    // RLS interceptor — only sets session-local vars when req.user is present
    { provide: APP_INTERCEPTOR, useClass: RlsInterceptor },
  ],
})
export class AppModule {}
