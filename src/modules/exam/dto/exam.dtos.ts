import { IsString, IsUUID, IsNotEmpty, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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

  @ApiProperty({ description: 'Exam UUID to assign' })
  @IsUUID()
  examId: string;
}
