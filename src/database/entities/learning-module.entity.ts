import {
  Column,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { BaseEntity } from './base.entity';
import { Certificate } from './certificate.entity';
import { Lesson } from './lesson.entity';

@Entity('learning_modules')
export class LearningModule extends BaseEntity {
  @Index()
  @Column({ type: 'int' })
  certId: number;

  @ManyToOne(() => Certificate, (c) => c.learningModules, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cert_id' })
  certificate: Certificate;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'int', default: 0 })
  position: number;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @OneToMany(() => Lesson, (l) => l.module)
  lessons: Lesson[];
}
