import {
  CreateDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * UUID-keyed base — used for any entity with external surface area
 * (referenced in URLs, shared with external services, exposed to clients).
 *
 * Postgres generates the UUID via `gen_random_uuid()` (pgcrypto extension).
 * The init.sql Docker init script ensures pgcrypto is installed.
 */
export abstract class UuidEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

/**
 * Serial-keyed base — used for internal-only entities (audit logs, queue rows,
 * rate-limit blocks, etc.) that are never exposed externally. Cheaper indexes,
 * better cache locality, and the enumerability concern doesn't apply.
 */
export abstract class IntEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

/**
 * Legacy export kept so the rest of the codebase compiles during the
 * migration. Aliased to UuidEntity — anything that was using `BaseEntity`
 * directly will pick up UUID PKs. New code should use UuidEntity or IntEntity
 * explicitly.
 *
 * @deprecated Use UuidEntity or IntEntity directly.
 */
export const BaseEntity = UuidEntity;
export type BaseEntity = UuidEntity;
