import {
  Column,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { BaseEntity } from './base.entity';
import { LearningModule } from './learning-module.entity';
import { LessonQuiz } from './lesson-quiz.entity';
import { StudentProgress } from './student-progress.entity';

@Entity('lessons')
export class Lesson extends BaseEntity {
  @Index()
  @Column({ type: 'int' })
  moduleId: number;

  @ManyToOne(() => LearningModule, (m) => m.lessons, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'module_id' })
  module: LearningModule;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  videoUrl: string | null;

  @Column({ type: 'text', nullable: true })
  contentText: string | null;

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
