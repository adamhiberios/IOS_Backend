import { Column, Entity, Index, ManyToOne, JoinColumn } from 'typeorm';
import { UuidEntity, IntEntity } from './base.entity';
import { AdminUser } from './admin-user.entity';
import { User } from './user.entity';

// ── PromoCode (UUID — user-facing) ───────────────────────────────────────────

export enum DiscountType {
  PERCENTAGE = 'percentage',
  FULL_WAIVER = 'full_waiver',
}

@Entity('promo_codes')
export class PromoCode extends UuidEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 100 })
  code: string;

  @Column({ type: 'enum', enum: DiscountType })
  discountType: DiscountType;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  discountValue: number | null;

  /** NULL = applies to all certificates. */
  @Column({ type: 'uuid', array: true, nullable: true })
  applicableCertIds: string[] | null;

  @Column({ type: 'int', nullable: true })
  maxUses: number | null;

  @Column({ type: 'int', default: 0 })
  usageCount: number;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @ManyToOne(() => AdminUser, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: AdminUser | null;
}

// ── ProcessedWebhook (internal — serial) ─────────────────────────────────────

@Entity('processed_webhooks')
export class ProcessedWebhook extends IntEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  eventId: string;

  @Column({ type: 'varchar', length: 100 })
  eventType: string;

  @Column({ type: 'timestamptz' })
  processedAt: Date;
}

// ── AdminAuditLog (internal — serial) ────────────────────────────────────────

@Entity('admin_audit_logs')
export class AdminAuditLog extends IntEntity {
  @Index()
  @Column({ type: 'uuid' })
  actorId: string;

  @ManyToOne(() => AdminUser, (u) => u.auditLogs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'actor_id' })
  actor: AdminUser;

  @Column({ type: 'varchar', length: 100 })
  action: string;

  @Column({ type: 'varchar', length: 100 })
  tableName: string;

  /**
   * UUID of the affected row. Nullable to support multi-row operations
   * and tables with non-UUID PKs.
   */
  @Column({ type: 'varchar', length: 100, nullable: true })
  recordId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  oldData: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  newData: Record<string, unknown> | null;

  @Column({ type: 'inet', nullable: true })
  ipAddress: string | null;
}

// ── NotificationTemplate (internal — serial) ─────────────────────────────────

@Entity('notification_templates')
export class NotificationTemplate extends IntEntity {
  @Column({ type: 'varchar', length: 100 })
  type: string;

  @Column({ type: 'varchar', length: 10, default: 'en' })
  locale: string;

  @Column({ type: 'varchar', length: 255 })
  subject: string;

  @Column({ type: 'text' })
  htmlBody: string;

  @Column({ type: 'text' })
  textBody: string;
}

// ── NotificationQueue (internal — serial) ────────────────────────────────────

export enum NotificationStatus {
  PENDING = 'pending',
  SENT = 'sent',
  FAILED = 'failed',
}

@Entity('notification_queue')
export class NotificationQueue extends IntEntity {
  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 100 })
  templateType: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({
    type: 'enum',
    enum: NotificationStatus,
    default: NotificationStatus.PENDING,
  })
  status: NotificationStatus;

  @Column({ type: 'timestamptz', nullable: true })
  scheduledAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ type: 'int', default: 0 })
  retryCount: number;
}
