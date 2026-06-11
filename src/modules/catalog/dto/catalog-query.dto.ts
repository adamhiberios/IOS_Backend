import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Query string for `GET /catalog` (and the admin variant). Mirrors the
 * pagination + filtering conventions from the architecture study §4.2–§4.3.
 */
export class CatalogQueryDto {
  @ApiPropertyOptional({
    description: 'Free-text trigram search against the English title.',
    example: 'scrum',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by program code (e.g. PSM, PSPO).',
    example: 'PSM',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  program_code?: string;

  @ApiPropertyOptional({
    description:
      'Filter by active flag. Defaults to true on the public endpoint; admin endpoint passes through.',
    example: true,
  })
  @IsOptional()
  // NOT @Type(() => Boolean): Boolean('false') === true, which silently
  // flipped ?active=false to true (H6, audit 2026-06-11). Strict parse —
  // anything other than 'true'/'false' falls through to @IsBoolean and 400s.
  @Transform(({ value }) =>
    value === 'true' || value === true
      ? true
      : value === 'false' || value === false
        ? false
        : value,
  )
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    description:
      'Opaque cursor returned in `meta.pagination.next_cursor` of a previous response.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Page size. Default 20, max 100.',
    example: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Sort by created_at. `-created_at` (default) is newest-first.',
    example: '-created_at',
    enum: ['-created_at', 'created_at'],
  })
  @IsOptional()
  @IsIn(['-created_at', 'created_at'])
  sort?: '-created_at' | 'created_at';
}
