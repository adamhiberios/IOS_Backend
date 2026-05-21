import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Certificate,
  LearningModule as LearningModuleEntity,
  Lesson,
  StudentProgress,
  StudentPurchase,
} from '../../database/entities';
import { LearningService } from './learning.service';
import { LearningController } from './learning.controller';
import { LearningAdminController } from './learning-admin.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Certificate,
      LearningModuleEntity,
      Lesson,
      StudentProgress,
      StudentPurchase,
    ]),
  ],
  controllers: [LearningController, LearningAdminController],
  providers: [LearningService],
  exports: [LearningService],
})
export class LearningModule {}
