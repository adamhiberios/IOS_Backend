import {
  Column,
  Entity,
  Index,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from './base.entity';
import { StudentPurchase } from './student-purchase.entity';
import { StudentProgress } from './student-progress.entity';
import { ExamAttempt } from './exam-attempt.entity';
import { ExamAccessCode } from './exam-access-code.entity';
import { IssuedCertificate } from './issued-certificate.entity';
import { Transaction } from './transaction.entity';
import { RefreshToken } from './refresh-token.entity';
import { TestSession } from './test-session.entity';

@Entity('users')
export class User extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 255 })
  passwordHash: string;

  @Column({ type: 'varchar', length: 255 })
  fullName: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  company: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  occupation: string | null;

  @Column({ type: 'varchar', length: 10, default: 'en' })
  locale: string;

  @Column({ type: 'boolean', default: false })
  emailVerified: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  emailVerifiedAt: Date | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @OneToMany(() => StudentPurchase, (p) => p.user)
  purchases: StudentPurchase[];

  @OneToMany(() => StudentProgress, (p) => p.user)
  progress: StudentProgress[];

  @OneToMany(() => ExamAttempt, (a) => a.user)
  examAttempts: ExamAttempt[];

  @OneToMany(() => ExamAccessCode, (c) => c.user)
  examAccessCodes: ExamAccessCode[];

  @OneToMany(() => IssuedCertificate, (c) => c.user)
  issuedCertificates: IssuedCertificate[];

  @OneToMany(() => Transaction, (t) => t.user)
  transactions: Transaction[];

  @OneToMany(() => RefreshToken, (t) => t.user)
  refreshTokens: RefreshToken[];

  @OneToMany(() => TestSession, (s) => s.user)
  testSessions: TestSession[];
}
