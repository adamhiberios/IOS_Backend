import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdminUser } from '../../database/entities';
import { SeederService } from './seeder.service';

@Module({
  imports: [TypeOrmModule.forFeature([AdminUser])],
  providers: [SeederService],
})
export class SeederModule {}
