import { IsString, IsUUID, IsNotEmpty, IsObject, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── Student DTOs ─────────────────────────────────────────────────────────────

export class ValidateAccessDto {
  @ApiProperty({ description: 'One-time plain-text access code' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ description: 'Exam UUID to validate the code against' })
  @IsUUID()
  examId: string;
}

export class StartExamDto {
  @ApiProperty({ description: 'One-time plain-text access code (same token from validate-access)' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ description: 'Exam UUID' })
  @IsUUID()
  examId: string;
}

export class AutosaveDto {
  @ApiProperty({
    description: 'Current answers as a map of questionId → optionId',
    example: { 'uuid-q1': 'uuid-opt-a', 'uuid-q2': 'uuid-opt-c' },
  })
  @IsObject()
  answers: Record<string, string>;
}

export class SubmitExamDto {
  @ApiProperty({
    description: 'Final answers as a map of questionId → optionId',
    example: { 'uuid-q1': 'uuid-opt-a', 'uuid-q2': 'uuid-opt-c' },
  })
  @IsObject()
  answers: Record<string, string>;
}

// ── Admin DTOs ───────────────────────────────────────────────────────────────

export class AssignExamDto {
  @ApiProperty({ description: 'Student user UUID' })
  @IsUUID()
  userId: string;

  @ApiProperty({ description: 'Certificate UUID' })
  @IsUUID()
  certId: string;

  @ApiPropertyOptional({
    description:
      'Exam UUID to assign explicitly. Omit to auto-assign the next exam per the SoT §2.3 algorithm: lowest unattempted exam_order among PUBLISHED exams for the certificate (403 when the pool is exhausted).',
  })
  @IsOptional()
  @IsUUID()
  examId?: string;
}
