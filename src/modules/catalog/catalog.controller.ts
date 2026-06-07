import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/decorators';
import { CatalogService } from './catalog.service';
import { CatalogQueryDto } from './dto/catalog-query.dto';
import {
  CatalogDetailResponseDto,
  CatalogListResponseDto,
} from './dto/catalog-response.dto';

/**
 * Public catalog endpoints. Anyone can browse — no auth required.
 * Returns ONLY active certificates and never exposes the raw `translations`
 * JSONB (admin matrix UI uses the admin-side controller for that).
 */
@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Browse active certificates',
    description:
      'Cursor-paginated list of active certificates with title/description ' +
      'resolved into the requested locale (Accept-Language / X-Lang / ' +
      'user pref). Falls back to English when a locale has no translation.',
  })
  @ApiResponse({ status: 200, type: CatalogListResponseDto })
  async list(
    @Query() query: CatalogQueryDto,
  ): Promise<CatalogListResponseDto> {
    return this.catalog.list(query, { adminView: false });
  }

  @Public()
  @Get(':id')
  @ApiOperation({
    summary: 'Get a single active certificate by ID',
    description:
      'Returns 404 for inactive (soft-deleted) certificates as well as for ' +
      'IDs that never existed — avoids leaking soft-delete state.',
  })
  @ApiResponse({ status: 200, type: CatalogDetailResponseDto })
  @ApiResponse({ status: 404, description: 'Certificate not found' })
  async getOne(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<CatalogDetailResponseDto> {
    return this.catalog.getById(id, { adminView: false });
  }
}
