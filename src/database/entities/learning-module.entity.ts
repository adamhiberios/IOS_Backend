import {
  Column,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { UuidEntity } from './base.entity';
import { Certificate } from './certificate.entity';
import { Lesson } from './lesson.entity';
import type { Translations } from '../../common/i18n/types';

@Entity('learning_modules')
export class LearningModule extends UuidEntity {
  @Index()
  @Column({ type: 'uuid' })
  certId: string;

  @ManyToOne(() => Certificate, (c) => c.learningModules, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'cert_id' })
  certificate: Certificate;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Per-locale title and description. See Certificate.translations for shape. */
  @Column({
    type: 'jsonb',
    default: () => `'{}'::jsonb`,
  })
  translations: Translations<'title' | 'description'>;

  @Column({ type: 'int', default: 0 })
  position: number;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @OneToMany(() => Lesson, (l) => l.module)
  lessons: Lesson[];
}
