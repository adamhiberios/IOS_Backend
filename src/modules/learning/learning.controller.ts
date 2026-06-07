import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators';
import type {
  AuthenticatedUser,
  RlsRequest,
} from '../../common/interceptors/rls.interceptor';
import { LearningService } from './learning.service';

/**
 * Student-facing learning endpoints. All require an authenticated student
 * JWT; admin tokens are accepted by the global JwtAuthGuard but rejected
 * here in `requireStudent`.
 *
 * RLS note: `student_purchases` has scoped RLS (ADR-010). The
 * `req.rlsRunner` opened by the global RlsInterceptor carries
 * `app.current_user_id`, so purchase-gate queries see only the caller's
 * rows even under the non-superuser test role. Service methods take the
 * runner as a parameter — non-RLS tables (lessons, modules, progress) use
 * the default pool.
 */
@ApiTags('learning')
@ApiBearerAuth()
@Controller('learning')
export class LearningController {
  constructor(private readonly learning: LearningService) {}

  @Get('certs/:certId/curriculum')
  @ApiOperation({
    summary: 'List modules + lessons for an enrolled certificate',
    description:
      'Returns the module/lesson tree for a cert the student has purchased. ' +
      'Includes per-lesson completion status. Returns 403 if the student ' +
      'has no purchase row for this cert.',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403, description: 'Not enrolled' })
  @ApiResponse({ status: 404, description: 'Certificate not found' })
  async getCurriculum(
    @Req() req: RlsRequest,
    @CurrentUser() user: AuthenticatedUser,
    @Param('certId', new ParseUUIDPipe()) certId: string,
  ) {
    this.requireStudent(user);
    return this.learning.getCurriculum(user.id!, certId, req.rlsRunner);
  }

  @Get('lessons/:id')
  @ApiOperation({
    summary: 'Get a single lesson with its content + signed video URL',
    description:
      'Returns the full lesson content resolved into the requested locale. ' +
      'If the lesson has a video, a short-lived signed URL is minted; the ' +
      'TTL is reported in `meta.videoUrlExpiresInSeconds`. Gated by ' +
      'purchase — 403 otherwise.',
  })
  async getLesson(
    @Req() req: RlsRequest,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) lessonId: string,
  ) {
    this.requireStudent(user);
    return this.learning.serveLesson(user.id!, lessonId, req.rlsRunner);
  }

  @Post('lessons/:id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark a lesson as completed',
    description:
      'Idempotent — re-marking already-complete returns the original ' +
      'completion timestamp with `alreadyCompleted=true`.',
  })
  async markComplete(
    @Req() req: RlsRequest,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) lessonId: string,
  ) {
    this.requireStudent(user);
    return this.learning.markComplete(user.id!, lessonId, req.rlsRunner);
  }

  @Get('progress')
  @ApiOperation({
    summary: 'Per-cert progress summary for the authenticated student',
    description:
      'Returns one row per enrolled certificate with total/completed lesson ' +
      'counts and a rounded percent-complete figure.',
  })
  async progress(
    @Req() req: RlsRequest,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.requireStudent(user);
    return this.learning.getProgressSummary(user.id!, req.rlsRunner);
  }

  private requireStudent(user: AuthenticatedUser): void {
    if (user?.type !== 'student' || !user?.id) {
      throw new ForbiddenException(
        'This endpoint is for student accounts only',
      );
    }
  }
}
