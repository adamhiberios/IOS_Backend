import {
  Column,
  Entity,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Column as UUIDColumn } from 'typeorm';
import { User } from './user.entity';
import { Exam } from './exam.entity';

export enum TestSessionStatus {
  ACTIVE = 'active',
  SUBMITTED = 'submitted',
  EXPIRED = 'expired',
  AUTO_SUBMITTED = 'auto_submitted',
}

/**
 * Persistent mirror of the Redis session.
 * Written on session start and updated on every terminal event.
 * The `snapshot` column is updated on every autosave so the
 * keyspace-expiry handler always has a safe answer set to score.
 */
@Entity('test_sessions')
export class TestSession {
  @UUIDColumn({ type: 'uuid', primary: true, generated: 'uuid' })
  id: string;

  @Index()
  @Column({ type: 'int' })
  userId: number;

  @ManyToOne(() => User, (u) => u.testSessions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Index()
  @Column({ type: 'int' })
  examId: number;

  @ManyToOne(() => Exam, (e) => e.testSessions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'exam_id' })
  exam: Exam;

  /**
   * Short-lived JWT issued at session start. Contains session UUID in sub.
   */
  @Column({ type: 'text' })
  sessionToken: string;

  @Column({ type: 'timestamptz' })
  startedAt: Date;

  @Column({ type: 'int' })
  durationSeconds: number;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'enum', enum: TestSessionStatus, default: TestSessionStatus.ACTIVE })
  status: TestSessionStatus;

  @Column({ type: 'timestamptz', nullable: true })
  submittedAt: Date | null;

  /**
   * JSON snapshot of last autosaved answers: { questionId: selectedOptionId }
   * Updated by every autosave call. Used by keyspace-expiry handler.
   */
  @Column({ type: 'jsonb', nullable: true })
  snapshot: Record<string, number> | null;
}
