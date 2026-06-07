import {
  Column,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Check,
} from 'typeorm';
import { UuidEntity } from './base.entity';
import { Certificate } from './certificate.entity';
import { ExamAccessCode } from './exam-access-code.entity';
import { ExamAttempt } from './exam-attempt.entity';
import { TestSession } from './test-session.entity';
import type { Translations } from '../../common/i18n/types';

export enum ExamStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
}

export enum QuestionType {
  MCQ = 'mcq',
  TRUE_FALSE = 'true_false',
}

// ── Exam ─────────────────────────────────────────────────────────────────────

@Entity('exams')
@Check(`"exam_order" BETWEEN 1 AND 6`)
@Check(`"passing_score" BETWEEN 1 AND 100`)
export class Exam extends UuidEntity {
  @Index()
  @Column({ type: 'uuid' })
  certId: string;

  @ManyToOne(() => Certificate, (c) => c.exams, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cert_id' })
  certificate: Certificate;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'int' })
  examOrder: number;

  @Column({ type: 'enum', enum: ExamStatus, default: ExamStatus.DRAFT })
  status: ExamStatus;

  @Column({ type: 'int', default: 80 })
  passingScore: number;

  @Column({ type: 'int' })
  durationMinutes: number;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  /** Per-locale exam title shown to the student before starting. */
  @Column({
    type: 'jsonb',
    default: () => `'{}'::jsonb`,
  })
  translations: Translations<'title'>;

  @OneToMany(() => ExamQuestion, (q) => q.exam, { cascade: true })
  questions: ExamQuestion[];

  @OneToMany(() => ExamAccessCode, (c) => c.exam)
  accessCodes: ExamAccessCode[];

  @OneToMany(() => ExamAttempt, (a) => a.exam)
  attempts: ExamAttempt[];

  @OneToMany(() => TestSession, (s) => s.exam)
  testSessions: TestSession[];
}

// ── ExamQuestion ─────────────────────────────────────────────────────────────

@Entity('exam_questions')
export class ExamQuestion extends UuidEntity {
  @Index()
  @Column({ type: 'uuid' })
  examId: string;

  @ManyToOne(() => Exam, (e) => e.questions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'exam_id' })
  exam: Exam;

  @Column({ type: 'text' })
  questionText: string;

  @Column({ type: 'enum', enum: QuestionType, default: QuestionType.MCQ })
  questionType: QuestionType;

  @Column({ type: 'int', default: 0 })
  position: number;

  @Column({ type: 'int', default: 1 })
  marks: number;

  @OneToMany(() => ExamQuestionOption, (o) => o.question, { cascade: true })
  options: ExamQuestionOption[];
}

// ── ExamQuestionOption ───────────────────────────────────────────────────────

@Entity('exam_question_options')
export class ExamQuestionOption extends UuidEntity {
  @Index()
  @Column({ type: 'uuid' })
  questionId: string;

  @ManyToOne(() => ExamQuestion, (q) => q.options, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'question_id' })
  question: ExamQuestion;

  @Column({ type: 'text' })
  optionText: string;

  @Column({ type: 'boolean', default: false })
  isCorrect: boolean;
}
