import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSource, DataSourceOptions } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load .env when this file is used by the TypeORM CLI (migrations).
// In runtime (Nest app), ConfigModule has already loaded it before this runs.
dotenv.config();

import {
  User,
  AdminUser,
  Certificate,
  LearningModule,
  Lesson,
  LessonQuiz,
  QuizQuestion,
  Exam,
  ExamQuestion,
  ExamQuestionOption,
  ExamAccessCode,
  ExamAttempt,
  TestSession,
  StudentPurchase,
  StudentProgress,
  IssuedCertificate,
  Transaction,
  PromoCode,
  ProcessedWebhook,
  AdminAuditLog,
  NotificationTemplate,
  NotificationQueue,
  RefreshToken,
  RateLimitBlock,
  BlogArticle,
  AuthToken,
} from '../entities';

export const ALL_ENTITIES = [
  User,
  AdminUser,
  Certificate,
  LearningModule,
  Lesson,
  LessonQuiz,
  QuizQuestion,
  Exam,
  ExamQuestion,
  ExamQuestionOption,
  ExamAccessCode,
  ExamAttempt,
  TestSession,
  StudentPurchase,
  StudentProgress,
  IssuedCertificate,
  Transaction,
  PromoCode,
  ProcessedWebhook,
  AdminAuditLog,
  NotificationTemplate,
  NotificationQueue,
  RefreshToken,
  RateLimitBlock,
  BlogArticle,
  AuthToken,
];

export const typeormConfig = (): TypeOrmModuleOptions => ({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: ALL_ENTITIES,
  migrations: [path.join(__dirname, '../migrations/*.{ts,js}')],
  namingStrategy: new SnakeNamingStrategy(),
  synchronize: false, // Never true in any env — use migrations only
  logging:
    process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
  extra: {
    // PgBouncer transaction-pool compatible settings
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
  },
});

/**
 * Standalone DataSource used by the TypeORM CLI for migrations.
 * Run: npx typeorm-ts-node-commonjs migration:generate -d src/database/config/typeorm.config.ts src/database/migrations/MigrationName
 */
export const AppDataSource = new DataSource({
  ...(typeormConfig() as DataSourceOptions),
  entities: ALL_ENTITIES,
  migrations: [path.join(__dirname, '../migrations/*.{ts,js}')],
});

export default registerAs('database', typeormConfig);
