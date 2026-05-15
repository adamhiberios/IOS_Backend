import {
  Column,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { UuidEntity } from './base.entity';
import { Lesson } from './lesson.entity';

@Entity('lesson_quizzes')
export class LessonQuiz extends UuidEntity {
  @Index()
  @Column({ type: 'uuid' })
  lessonId: string;

  @ManyToOne(() => Lesson, (l) => l.quizzes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lesson_id' })
  lesson: Lesson;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @OneToMany(() => QuizQuestion, (q) => q.quiz)
  questions: QuizQuestion[];
}

@Entity('quiz_questions')
export class QuizQuestion extends UuidEntity {
  @Index()
  @Column({ type: 'uuid' })
  quizId: string;

  @ManyToOne(() => LessonQuiz, (q) => q.questions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'quiz_id' })
  quiz: LessonQuiz;

  @Column({ type: 'text' })
  questionText: string;

  @Column({ type: 'text' })
  correctAnswer: string;

  @Column({ type: 'jsonb', nullable: true })
  options: string[] | null;

  @Column({ type: 'int', default: 0 })
  position: number;
}
