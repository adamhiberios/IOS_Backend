import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SUPPORTED_LOCALES } from '../../../common/i18n/types';

/** Inner shape for a single locale's authored content. */
export class CertificateLocaleDto {
  @ApiPropertyOptional({ example: 'Professional Scrum Master' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({ example: 'Foundational Scrum certification covering ...' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
}

export class CreateCertificateDto {
  @ApiProperty({
    example: 'Professional Scrum Master',
    description:
      'Canonical English title. Also mirrored into `translations.en.title` by the service.',
  })
  @IsString()
  @Length(1, 255)
  title: string;

  @ApiProperty({
    example: 'PSM',
    description: 'Short program code — uppercase, ≤50 chars.',
  })
  @IsString()
  @Length(1, 50)
  programCode: string;

  @ApiProperty({ example: 49.0 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price: number;

  @ApiPropertyOptional({ example: 'USD', default: 'USD' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiPropertyOptional({
    example: 'Foundational Scrum certification…',
    description:
      'Canonical English description. Mirrored into `translations.en.description`.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({
    example: 'https://cdn.ios-lms.com/media/thumbnails/psm.jpg',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  thumbnailUrl?: string;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /**
   * Per-locale translations. Keys must be one of the supported locales. The
   * canonical `title` + `description` above are auto-mirrored into the `en`
   * entry by the service, so callers only need to supply this for non-English
   * locales. Sending an explicit `en` block overrides the mirror.
   */
  @ApiPropertyOptional({
    description:
      'Per-locale title / description. Supported locales: en, tr, fr, es, ar, de.',
    type: 'object',
    additionalProperties: { type: 'object' },
    example: {
      tr: { title: 'Profesyonel Scrum Yöneticisi', description: '…' },
      ar: { title: 'سكرم ماستر', description: '…' },
    },
  })
  @IsOptional()
  @IsObject()
  translations?: Partial<Record<(typeof SUPPORTED_LOCALES)[number], CertificateLocaleDto>>;
}
