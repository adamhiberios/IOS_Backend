import {
  Column,
  Entity,
  Index,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';
import { Certificate } from './certificate.entity';

export enum PaymentType {
  ENROLLMENT = 'enrollment',
  RETAKE = 'retake',
}

@Entity('student_purchases')
@Unique(['userId', 'certId'])
export class StudentPurchase extends BaseEntity {
  @Index()
  @Column({ type: 'int' })
  userId: number;

  @ManyToOne(() => User, (u) => u.purchases, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Index()
  @Column({ type: 'int' })
  certId: number;

  @ManyToOne(() => Certificate, (c) => c.purchases, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cert_id' })
  certificate: Certificate;

  @Column({ type: 'varchar', length: 255, nullable: true })
  paymentIntentId: string | null;

  @Column({ type: 'enum', enum: PaymentType, default: PaymentType.ENROLLMENT })
  paymentType: PaymentType;

  /**
   * Student has confirmed readiness before exam assignment.
   */
  @Column({ type: 'boolean', default: false })
  preExamConfirmed: boolean;

  /**
   * Set to true when student passes an exam for this cert.
   */
  @Column({ type: 'boolean', default: false })
  examCompleted: boolean;
}
