import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Certificate } from '../../database/entities';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { CatalogAdminController } from './catalog-admin.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Certificate])],
  controllers: [CatalogController, CatalogAdminController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
