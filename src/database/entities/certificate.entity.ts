import { Column, Entity, Index, OneToMany } from 'typeorm';
import { UuidEntity } from './base.entity';
import { LearningModule } from './learning-module.entity';
import { Exam } from './exam.entity';
import { StudentPurchase } from './student-purchase.entity';
import { IssuedCertificate } from './issued-certificate.entity';
import { Transaction } from './transaction.entity';

@Entity('certificates')
export class Certificate extends UuidEntity {
  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Index()
  @Column({ type: 'varchar', length: 50 })
  programCode: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  price: number;

  @Column({ type: 'varchar', length: 3, default: 'USD' })
  currency: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'varchar', length: 500, nullable: true })
  thumbnailUrl: string | null;

  @OneToMany(() => LearningModule, (m) => m.certificate)
  learningModules: LearningModule[];

  @OneToMany(() => Exam, (e) => e.certificate)
  exams: Exam[];

  @OneToMany(() => StudentPurchase, (p) => p.certificate)
  purchases: StudentPurchase[];

  @OneToMany(() => IssuedCertificate, (c) => c.certificate)
  issuedCertificates: IssuedCertificate[];

  @OneToMany(() => Transaction, (t) => t.certificate)
  transactions: Transaction[];
}
