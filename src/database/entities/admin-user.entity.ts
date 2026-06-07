import {
  Column,
  Entity,
  Index,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { UuidEntity } from './base.entity';
import { AdminAuditLog } from './admin-audit-log.entity';

export enum AdminRole {
  SUPER_ADMIN = 'super_admin',
  LEARNING_ADMIN = 'learning_admin',
  CONTENT_CREATOR = 'content_creator',
  FINANCE_ADMIN = 'finance_admin',
  SUPPORT_ADMIN = 'support_admin',
}

@Entity('admin_users')
export class AdminUser extends UuidEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 255 })
  passwordHash: string;

  @Column({ type: 'varchar', length: 100 })
  firstName: string;

  @Column({ type: 'varchar', length: 100 })
  lastName: string;

  @Column({ type: 'enum', enum: AdminRole })
  role: AdminRole;

  /**
   * UI / notification locale preference for this admin. Used by the i18n
   * resolver chain (rank #1) so an Arabic-preferring admin sees Arabic
   * admin-portal copy even from a German-locale browser. CHECK constraint at
   * the DB layer enforces the supported set.
   */
  @Column({ type: 'varchar', length: 10, default: 'en' })
  locale: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @ManyToOne(() => AdminUser, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: AdminUser | null;

  @OneToMany(() => AdminAuditLog, (l) => l.actor)
  auditLogs: AdminAuditLog[];

  get fullName(): string {
    return `${this.firstName} ${this.lastName}`.trim();
  }
}
