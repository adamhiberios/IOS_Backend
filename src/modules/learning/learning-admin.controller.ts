import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { LearningService } from './learning.service';
import {
  CreateModuleDto,
  UpdateModuleDto,
} from './dto/module.dtos';
import {
  CreateLessonDto,
  UpdateLessonDto,
} from './dto/lesson.dtos';

@ApiTags('learning (admin)')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(RolesGuard)
export class LearningAdminController {
  constructor(private readonly learning: LearningService) {}

  // ── Modules ────────────────────────────────────────────────────────────

  @Post('modules')
  @Roles(AdminRole.CONTENT_CREATOR, AdminRole.LEARNING_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a learning module' })
  @ApiBody({ type: CreateModuleDto })
  @ApiResponse({ status: 201 })
  async createModule(@Body() dto: CreateModuleDto) {
    return { data: await this.learning.createModule(dto) };
  }

  @Patch('modules/:id')
  @Roles(AdminRole.CONTENT_CREATOR, AdminRole.LEARNING_ADMIN)
  @ApiOperation({ summary: 'Update a learning module (partial)' })
  @ApiBody({ type: UpdateModuleDto })
  async updateModule(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateModuleDto,
  ) {
    return { data: await this.learning.updateModule(id, dto) };
  }

  @Delete('modules/:id')
  @Roles(AdminRole.LEARNING_ADMIN)
  @ApiOperation({ summary: 'Soft-delete (deactivate) a module' })
  async softDeleteModule(@Param('id', new ParseUUIDPipe()) id: string) {
    return { data: await this.learning.softDeleteModule(id) };
  }

  // ── Lessons ────────────────────────────────────────────────────────────

  @Post('lessons')
  @Roles(AdminRole.CONTENT_CREATOR, AdminRole.LEARNING_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a lesson' })
  @ApiBody({ type: CreateLessonDto })
  async createLesson(@Body() dto: CreateLessonDto) {
    return { data: await this.learning.createLesson(dto) };
  }

  @Patch('lessons/:id')
  @Roles(AdminRole.CONTENT_CREATOR, AdminRole.LEARNING_ADMIN)
  @ApiOperation({ summary: 'Update a lesson (partial)' })
  @ApiBody({ type: UpdateLessonDto })
  async updateLesson(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateLessonDto,
  ) {
    return { data: await this.learning.updateLesson(id, dto) };
  }

  @Delete('lessons/:id')
  @Roles(AdminRole.LEARNING_ADMIN)
  @ApiOperation({ summary: 'Soft-delete (deactivate) a lesson' })
  async softDeleteLesson(@Param('id', new ParseUUIDPipe()) id: string) {
    return { data: await this.learning.softDeleteLesson(id) };
  }
}
