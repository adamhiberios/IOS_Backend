import {
  Column,
  Entity,
  Index,
  ManyToOne,
  JoinColumn,
  Check,
} from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';
import { Exam } from './exam.entity';
import { Certificate } from './certificate.entity';

export enum AttemptStatus {
  SUBMITTED = 'submitted',
  AUTO_SUBMITTED = 'auto_submitted',
}

@Entity('exam_attempts')
@Check(`"score" BETWEEN 0 AND 100`)
export class ExamAttempt extends BaseEntity {
  @Index()
  @Column({ type: 'int' })
  userId: number;

  @ManyToOne(() => User, (u) => u.examAttempts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Index()
  @Column({ type: 'int' })
  examId: number;

  @ManyToOne(() => Exam, (e) => e.attempts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'exam_id' })
  exam: Exam;

  @Column({ type: 'int' })
  certId: number;

  @ManyToOne(() => Certificate, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cert_id' })
  certificate: Certificate;

  @Column({ type: 'numeric', precision: 5, scale: 2 })
  score: number;

  @Column({ type: 'boolean' })
  passed: boolean;

  /**
   * Full answer snapshot: { questionId: selectedOptionId }
   * Immutable once written.
   */
  @Column({ type: 'jsonb' })
  answers: Record<string, number>;

  @Column({ type: 'int', nullable: true })
  durationSeconds: number | null;

  @Column({ type: 'timestamptz' })
  startedAt: Date;

  @Column({ type: 'timestamptz' })
  submittedAt: Date;

  @Column({ type: 'enum', enum: AttemptStatus, default: AttemptStatus.SUBMITTED })
  status: AttemptStatus;

  /**
   * True when submission arrived within the 2-minute grace window after Redis expiry.
   */
  @Column({ type: 'boolean', default: false })
  lateFlag: boolean;
}
