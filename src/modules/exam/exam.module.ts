import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { Exam, ExamQuestion, ExamQuestionOption } from '../../database/entities/exam.entity';
import { ExamAccessCode } from '../../database/entities/exam-access-code.entity';
import { ExamAttempt } from '../../database/entities/exam-attempt.entity';
import { TestSession } from '../../database/entities/test-session.entity';

import { ExamService } from './exam.service';
import { ExamController, ExamAdminController } from './exam.controller';
import { ExamGateway } from './exam.gateway';
import { ExamKeyspaceHandler } from './exam-keyspace.handler';
import { TestSessionService } from './test-session.service';

/**
 * ExamModule — Week 4 exam engine.
 *
 * Owns:
 *  - ExamService         — lifecycle orchestration (assign, validate, start, submit, score)
 *  - TestSessionService  — Redis session CRUD (no TTL reset on autosave)
 *  - ExamGateway         — socket.io /exam namespace, JWT auth, timer ticks, WS events
 *  - ExamKeyspaceHandler — reacts to redis.keyspace.expired, manages grace window + auto-submit
 *
 * RedisModule is @Global() so RedisService and REDIS_CLIENT are already
 * available without re-importing here.
 *
 * JwtModule is imported locally (same config as AuthModule) so the gateway
 * can verify access tokens independently without depending on AuthModule.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Exam,
      ExamQuestion,
      ExamQuestionOption,
      ExamAccessCode,
      ExamAttempt,
      TestSession,
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [ExamController, ExamAdminController],
  providers: [
    ExamService,
    TestSessionService,
    ExamGateway,
    ExamKeyspaceHandler,
  ],
  exports: [ExamService, TestSessionService],
})
export class ExamModule {}
