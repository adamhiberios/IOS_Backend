import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
} from 'class-validator';
import { SUPPORTED_LOCALES } from '../../../common/i18n/types';
import { CertificateLocaleDto } from './create-certificate.dto';

/**
 * Partial update of a certificate. Any field omitted is left untouched. To
 * update `translations` specifically, prefer the dedicated
 * `PATCH /admin/catalog/:id/translations` endpoint — this one replaces the
 * entire JSONB column when present.
 */
export class UpdateCertificateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 255)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 50)
  programCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  thumbnailUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  translations?: Partial<
    Record<(typeof SUPPORTED_LOCALES)[number], CertificateLocaleDto>
  >;
}

export class UpdateTranslationsDto {
  @ApiPropertyOptional({
    description:
      'Partial translations object. Each supplied locale key REPLACES the ' +
      'existing entry for that locale; locales not present in the body are ' +
      'preserved. Top-level merge semantics — to clear a locale, pass `{}`.',
    example: { tr: { title: 'Yeni başlık' } },
  })
  @IsObject()
  translations: Partial<
    Record<(typeof SUPPORTED_LOCALES)[number], CertificateLocaleDto>
  >;
}
