import { Column, Entity, Index, ManyToOne, JoinColumn } from 'typeorm';
import { IntEntity } from './base.entity';
import { User } from './user.entity';

export enum AuthTokenPurpose {
  EMAIL_VERIFICATION = 'email_verification',
  PASSWORD_RESET = 'password_reset',
}

/**
 * Short-lived single-use tokens for account flows (email verification,
 * password reset). Tokens are bcrypt-hashed; plain token only exists in
 * the email body and is never stored.
 *
 * Internal-only — never exposed in URLs or shared externally. Serial PK.
 */
@Entity('auth_tokens')
export class AuthToken extends IntEntity {
  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'enum', enum: AuthTokenPurpose })
  purpose: AuthTokenPurpose;

  @Column({ type: 'varchar', length: 255 })
  tokenHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date | null;
}
