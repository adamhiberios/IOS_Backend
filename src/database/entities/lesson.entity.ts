import {
  Column,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { UuidEntity } from './base.entity';
import { LearningModule } from './learning-module.entity';
import { LessonQuiz } from './lesson-quiz.entity';
import { StudentProgress } from './student-progress.entity';
import type { Translations } from '../../common/i18n/types';

@Entity('lessons')
export class Lesson extends UuidEntity {
  @Index()
  @Column({ type: 'uuid' })
  moduleId: string;

  @ManyToOne(() => LearningModule, (m) => m.lessons, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'module_id' })
  module: LearningModule;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  videoUrl: string | null;

  @Column({ type: 'text', nullable: true })
  contentText: string | null;

  /** Per-locale title and rich-text body. See Certificate.translations for shape. */
  @Column({
    type: 'jsonb',
    default: () => `'{}'::jsonb`,
  })
  translations: Translations<'title' | 'content_html'>;

  @Column({ type: 'int', default: 0 })
  position: number;

  @Column({ type: 'int', nullable: true })
  durationSeconds: number | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @OneToMany(() => LessonQuiz, (q) => q.lesson)
  quizzes: LessonQuiz[];

  @OneToMany(() => StudentProgress, (p) => p.lesson)
  studentProgress: StudentProgress[];
}
