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

export class ModuleLocaleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
}

export class CreateModuleDto {
  @ApiProperty({ example: '9ae3-...', description: 'Parent certificate UUID' })
  @IsUUID()
  certId: string;

  @ApiProperty({ example: 'Module 1 — Foundations' })
  @IsString()
  @Length(1, 255)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({ example: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  position?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    description:
      'Per-locale title / description. en is auto-mirrored from canonical.',
    type: 'object',
    additionalProperties: { type: 'object' },
  })
  @IsOptional()
  @IsObject()
  translations?: Partial<
    Record<(typeof SUPPORTED_LOCALES)[number], ModuleLocaleDto>
  >;
}

export class UpdateModuleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 255)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  position?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  translations?: Partial<
    Record<(typeof SUPPORTED_LOCALES)[number], ModuleLocaleDto>
  >;
}
