import { Column, Entity, Index, ManyToOne, JoinColumn } from 'typeorm';
import { UuidEntity, IntEntity } from './base.entity';
import { User } from './user.entity';
import { AdminUser } from './admin-user.entity';

// ── RefreshToken (internal — serial) ─────────────────────────────────────────

export enum TokenOwnerType {
  USER = 'user',
  ADMIN = 'admin',
}

@Entity('refresh_tokens')
export class RefreshToken extends IntEntity {
  @Index()
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => User, (u) => u.refreshTokens, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  adminId: string | null;

  @ManyToOne(() => AdminUser, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'admin_id' })
  admin: AdminUser | null;

  @Column({ type: 'enum', enum: TokenOwnerType })
  ownerType: TokenOwnerType;

  /** bcrypt hash of the refresh token. Plain token is never stored. */
  @Column({ type: 'varchar', length: 255 })
  tokenHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;
}

// ── RateLimitBlock (internal — serial) ───────────────────────────────────────

@Entity('rate_limit_blocks')
export class RateLimitBlock extends IntEntity {
  @Index()
  @Column({ type: 'inet' })
  ipAddress: string;

  @Column({ type: 'varchar', length: 100 })
  endpoint: string;

  @Column({ type: 'timestamptz' })
  blockedUntil: Date;
}

// ── BlogArticle (UUID — user-facing) ─────────────────────────────────────────

export enum BlogStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
}

@Entity('blog_articles')
export class BlogArticle extends UuidEntity {
  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  slug: string;

  @Column({ type: 'text' })
  contentHtml: string;

  @Column({ type: 'enum', enum: BlogStatus, default: BlogStatus.DRAFT })
  status: BlogStatus;

  @Column({ type: 'uuid', nullable: true })
  authorId: string | null;

  @ManyToOne(() => AdminUser, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'author_id' })
  author: AdminUser | null;

  @Column({ type: 'text', nullable: true })
  metaDescription: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  publishedAt: Date | null;
}
