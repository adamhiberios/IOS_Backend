import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
} from 'class-validator';
import { SUPPORTED_LOCALES } from '../../../common/i18n/types';

export class LessonLocaleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50_000)
  content_html?: string;
}

export class CreateLessonDto {
  @ApiProperty({ description: 'Parent learning_module UUID' })
  @IsUUID()
  moduleId: string;

  @ApiProperty({ example: 'Lesson 1 — Sprint Planning' })
  @IsString()
  @Length(1, 255)
  title: string;

  @ApiPropertyOptional({
    description: 'Canonical English content (HTML or rich text).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50_000)
  contentText?: string;

  @ApiPropertyOptional({
    description: 'Signed-URL-eligible video key inside the videos bucket.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  videoUrl?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  position?: number;

  @ApiPropertyOptional({ description: 'Video duration in seconds.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  durationSeconds?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    description:
      'Per-locale title / content_html. en is auto-mirrored from canonical.',
    type: 'object',
    additionalProperties: { type: 'object' },
  })
  @IsOptional()
  @IsObject()
  translations?: Partial<
    Record<(typeof SUPPORTED_LOCALES)[number], LessonLocaleDto>
  >;
}

export class UpdateLessonDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 255)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50_000)
  contentText?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  videoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  position?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  durationSeconds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  translations?: Partial<
    Record<(typeof SUPPORTED_LOCALES)[number], LessonLocaleDto>
  >;
}
