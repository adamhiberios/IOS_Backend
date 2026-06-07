import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminRole } from '../../database/entities';
import { CatalogService } from './catalog.service';
import { CatalogQueryDto } from './dto/catalog-query.dto';
import { CreateCertificateDto } from './dto/create-certificate.dto';
import {
  UpdateCertificateDto,
  UpdateTranslationsDto,
} from './dto/update-certificate.dto';
import {
  CatalogDetailResponseDto,
  CatalogListResponseDto,
} from './dto/catalog-response.dto';

/**
 * Admin-side catalog CRUD. RolesGuard enforces the staff tier — the role
 * hierarchy means LEARNING_ADMIN covers CONTENT_CREATOR for all but delete.
 *
 *   POST   /admin/catalog                  → learning_admin, content_creator
 *   GET    /admin/catalog (inc. inactive)  → learning_admin, content_creator
 *   GET    /admin/catalog/:id              → learning_admin, content_creator
 *   PATCH  /admin/catalog/:id              → learning_admin, content_creator
 *   PATCH  /admin/catalog/:id/translations → learning_admin, content_creator
 *   DELETE /admin/catalog/:id  (soft)      → learning_admin only
 */
@ApiTags('catalog (admin)')
@ApiBearerAuth()
@Controller('admin/catalog')
@UseGuards(RolesGuard)
export class CatalogAdminController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @Roles(AdminRole.CONTENT_CREATOR, AdminRole.LEARNING_ADMIN)
  @ApiOperation({ summary: 'List certificates (admin — includes inactive)' })
  @ApiResponse({ status: 200, type: CatalogListResponseDto })
  list(@Query() query: CatalogQueryDto): Promise<CatalogListResponseDto> {
    return this.catalog.list(query, { adminView: true });
  }

  @Get(':id')
  @Roles(AdminRole.CONTENT_CREATOR, AdminRole.LEARNING_ADMIN)
  @ApiOperation({ summary: 'Get one certificate (admin — includes inactive + raw translations)' })
  @ApiResponse({ status: 200, type: CatalogDetailResponseDto })
  @ApiResponse({ status: 404, description: 'Not found' })
  getOne(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<CatalogDetailResponseDto> {
    return this.catalog.getById(id, { adminView: true });
  }

  @Post()
  @Roles(AdminRole.CONTENT_CREATOR, AdminRole.LEARNING_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a certificate' })
  @ApiBody({ type: CreateCertificateDto })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 409, description: 'Program code already exists' })
  async create(@Body() dto: CreateCertificateDto) {
    const data = await this.catalog.create(dto);
    return { data };
  }

  @Patch(':id')
  @Roles(AdminRole.CONTENT_CREATOR, AdminRole.LEARNING_ADMIN)
  @ApiOperation({ summary: 'Update a certificate (partial)' })
  @ApiBody({ type: UpdateCertificateDto })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCertificateDto,
  ) {
    const data = await this.catalog.update(id, dto);
    return { data };
  }

  @Patch(':id/translations')
  @Roles(AdminRole.CONTENT_CREATOR, AdminRole.LEARNING_ADMIN)
  @ApiOperation({
    summary: 'Update certificate translations (shallow per-locale merge)',
    description:
      'Each supplied locale REPLACES the existing block for that locale; ' +
      'locales not present in the body are preserved unchanged.',
  })
  @ApiBody({ type: UpdateTranslationsDto })
  @ApiResponse({ status: 200, description: 'Translations merged' })
  async updateTranslations(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateTranslationsDto,
  ) {
    const data = await this.catalog.updateTranslations(id, dto.translations);
    return { data };
  }

  @Delete(':id')
  @Roles(AdminRole.LEARNING_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Soft-delete (deactivate) a certificate',
    description:
      'Sets `active=false`. The certificate disappears from the public catalog ' +
      'but is preserved for analytics and re-activation. There is no hard delete.',
  })
  @ApiResponse({ status: 200, description: 'Deactivated' })
  async softDelete(@Param('id', new ParseUUIDPipe()) id: string) {
    return { data: await this.catalog.softDelete(id) };
  }
}
