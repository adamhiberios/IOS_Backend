import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';

import { ExamService } from './exam.service';
import {
  ValidateAccessDto,
  StartExamDto,
  AutosaveDto,
  SubmitExamDto,
  AssignExamDto,
} from './dto/exam.dtos';
import { CurrentUser } from '../auth/decorators';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminRole } from '../../database/entities/admin-user.entity';

// ── Student endpoints (/api/v1/exam/...) ─────────────────────────────────────

@ApiTags('Exam')
@ApiBearerAuth()
@Controller('exam')
export class ExamController {
  constructor(private readonly examService: ExamService) {}

  @Post('validate-access')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate a one-time access code without consuming it' })
  @ApiOkResponse({ description: 'Code is valid; returns exam metadata' })
  @ApiForbiddenResponse({ description: 'Invalid or expired access code' })
  async validateAccess(
    @CurrentUser('id') userId: string,
    @Body() dto: ValidateAccessDto,
  ) {
    const { exam, accessCodeId } = await this.examService.validateAccess(
      userId,
      dto.code,
      dto.examId,
    );
    return {
      valid: true,
      accessCodeId,
      exam: {
        id: exam.id,
        title: exam.title,
        durationMinutes: exam.durationMinutes,
        passingScore: exam.passingScore,
      },
    };
  }

  @Post('start')
  @ApiOperation({ summary: 'Consume access code and start an exam session' })
  @ApiCreatedResponse({ description: 'Session created; returns sessionId + questions' })
  @ApiConflictResponse({ description: 'Active session already exists / code already used' })
  async startExam(
    @CurrentUser('id') userId: string,
    @Body() dto: StartExamDto,
  ) {
    const result = await this.examService.startExam(userId, dto.code, dto.examId);

    // Strip isCorrect from options before sending to client.
    const questions = result.questions.map((q) => ({
      id: q.id,
      questionText: q.questionText,
      questionType: q.questionType,
      position: q.position,
      options: q.options?.map((o) => ({
        id: o.id,
        optionText: o.optionText,
      })),
    }));

    return {
      sessionId: result.sessionId,
      durationSeconds: result.durationSeconds,
      expiresAt: result.expiresAt,
      questions,
    };
  }

  @Get('sessions/:sessionId')
  @ApiOperation({ summary: 'Get current session status and remaining time' })
  @ApiOkResponse({ description: 'Session status including remaining seconds' })
  @ApiNotFoundResponse({ description: 'Session not found' })
  async getSessionStatus(
    @CurrentUser('id') userId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    return this.examService.getSessionStatus(sessionId, userId);
  }

  @Post('sessions/:sessionId/autosave')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Autosave current answers (no TTL reset)' })
  @ApiOkResponse({ description: 'Answers saved' })
  async autosave(
    @CurrentUser('id') userId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: AutosaveDto,
  ) {
    await this.examService.autosave(sessionId, userId, dto.answers);
    return { saved: true };
  }

  @Post('sessions/:sessionId/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit exam — scores answers and persists the attempt' })
  @ApiOkResponse({ description: 'Score result' })
  async submit(
    @CurrentUser('id') userId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: SubmitExamDto,
  ) {
    return this.examService.submitExam(sessionId, userId, dto.answers);
  }

  @Post('sessions/:sessionId/late-submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Late submit within the 2-minute grace window (BE-037)',
    description:
      'Available for up to 120 seconds after the session clock hits zero. ' +
      'Sets lateFlag=true on the resulting attempt.',
  })
  @ApiForbiddenResponse({ description: 'Grace window has closed' })
  async lateSubmit(
    @CurrentUser('id') userId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: SubmitExamDto,
  ) {
    return this.examService.lateSubmitExam(sessionId, userId, dto.answers);
  }
}

// ── Admin endpoints (/api/v1/admin/exam/...) ─────────────────────────────────

@ApiTags('Admin — Exam')
@ApiBearerAuth()
@Controller('admin/exam')
@UseGuards(RolesGuard)
export class ExamAdminController {
  constructor(private readonly examService: ExamService) {}

  @Post('assign')
  @Roles(AdminRole.LEARNING_ADMIN)
  @ApiOperation({ summary: 'Assign an exam to a student and issue a one-time access code' })
  @ApiCreatedResponse({ description: 'Access code created; returns plain code (show once)' })
  async assignExam(@Body() dto: AssignExamDto) {
    const { plainCode, expiresAt } = await this.examService.assignExam(
      dto.userId,
      dto.examId,
      dto.certId,
    );
    return {
      plainCode,
      expiresAt,
      message: 'Store or send this code to the student. It is shown only once.',
    };
  }
}
