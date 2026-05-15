import { Column, Entity, Index, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { UuidEntity } from './base.entity';
import { User } from './user.entity';
import { Certificate } from './certificate.entity';

export enum PaymentType {
  ENROLLMENT = 'enrollment',
  RETAKE = 'retake',
}

@Entity('student_purchases')
@Unique(['userId', 'certId'])
export class StudentPurchase extends UuidEntity {
  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, (u) => u.purchases, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Index()
  @Column({ type: 'uuid' })
  certId: string;

  @ManyToOne(() => Certificate, (c) => c.purchases, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cert_id' })
  certificate: Certificate;

  @Column({ type: 'varchar', length: 255, nullable: true })
  paymentIntentId: string | null;

  @Column({ type: 'enum', enum: PaymentType, default: PaymentType.ENROLLMENT })
  paymentType: PaymentType;

  @Column({ type: 'boolean', default: false })
  preExamConfirmed: boolean;

  @Column({ type: 'boolean', default: false })
  examCompleted: boolean;
}
