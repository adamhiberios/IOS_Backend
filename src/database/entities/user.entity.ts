import { Column, Entity, Index, OneToMany } from 'typeorm';
import { UuidEntity } from './base.entity';
import { StudentPurchase } from './student-purchase.entity';
import { StudentProgress } from './student-progress.entity';
import { ExamAttempt } from './exam-attempt.entity';
import { ExamAccessCode } from './exam-access-code.entity';
import { IssuedCertificate } from './issued-certificate.entity';
import { Transaction } from './transaction.entity';
import { RefreshToken } from './refresh-token.entity';
import { TestSession } from './test-session.entity';

@Entity('users')
export class User extends UuidEntity {
  // ── Personal information ───────────────────────────────────────────────

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 255 })
  passwordHash: string;

  @Column({ type: 'varchar', length: 100 })
  firstName: string;

  @Column({ type: 'varchar', length: 100 })
  lastName: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  phone: string | null;

  /**
   * Object-storage URL of the user's avatar. Uploaded to DO Spaces
   * via the StorageService (Week 3). Null until the user uploads one.
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  avatarUrl: string | null;

  // ── Location ──────────────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 100, nullable: true })
  country: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  street: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  postalCode: string | null;

  // ── Professional ──────────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 255, nullable: true })
  occupation: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  position: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  company: string | null;

  // ── Account state ─────────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 10, default: 'en' })
  locale: string;

  @Column({ type: 'boolean', default: false })
  emailVerified: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  emailVerifiedAt: Date | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  // ── Convenience accessor ──────────────────────────────────────────────

  /**
   * Computed full name. Not a DB column — derived from firstName + lastName.
   * Used by the cert generator and notification templates.
   */
  get fullName(): string {
    return `${this.firstName} ${this.lastName}`.trim();
  }

  // ── Relations ─────────────────────────────────────────────────────────

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
