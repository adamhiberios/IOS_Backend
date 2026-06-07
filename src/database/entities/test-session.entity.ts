import {
  Column,
  Entity,
  Index,
  ManyToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Exam } from './exam.entity';

export enum TestSessionStatus {
  ACTIVE = 'active',
  SUBMITTED = 'submitted',
  EXPIRED = 'expired',
  AUTO_SUBMITTED = 'auto_submitted',
}

/**
 * Persistent mirror of the Redis exam session.
 * Updated on every autosave so the keyspace-expiry handler always has a
 * safe answer set to score.
 */
@Entity('test_sessions')
export class TestSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, (u) => u.testSessions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Index()
  @Column({ type: 'uuid' })
  examId: string;

  @ManyToOne(() => Exam, (e) => e.testSessions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'exam_id' })
  exam: Exam;

  /**
   * The certificate this exam attempt is working towards.
   * Populated at startExam time from ExamAccessCode.certId.
   * Nullable because legacy rows pre-migration will not have it.
   */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  certId: string | null;

  @Column({ type: 'text' })
  sessionToken: string;

  @Column({ type: 'timestamptz' })
  startedAt: Date;

  @Column({ type: 'int' })
  durationSeconds: number;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({
    type: 'enum',
    enum: TestSessionStatus,
    default: TestSessionStatus.ACTIVE,
  })
  status: TestSessionStatus;

  @Column({ type: 'timestamptz', nullable: true })
  submittedAt: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  snapshot: Record<string, string> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
