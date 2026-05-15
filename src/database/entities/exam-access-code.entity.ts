import { Column, Entity, Index, ManyToOne, JoinColumn } from 'typeorm';
import { UuidEntity } from './base.entity';
import { User } from './user.entity';
import { Exam } from './exam.entity';
import { Certificate } from './certificate.entity';

@Entity('exam_access_codes')
export class ExamAccessCode extends UuidEntity {
  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, (u) => u.examAccessCodes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Index()
  @Column({ type: 'uuid' })
  examId: string;

  @ManyToOne(() => Exam, (e) => e.accessCodes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'exam_id' })
  exam: Exam;

  @Column({ type: 'uuid' })
  certId: string;

  @ManyToOne(() => Certificate, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cert_id' })
  certificate: Certificate;

  /** bcrypt hash of the plain token. Plain token is never stored. */
  @Column({ type: 'varchar', length: 255 })
  tokenHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  /** Set atomically on first use. NULL = unused. */
  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date | null;
}
