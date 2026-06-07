import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CatalogItemDto {
  @ApiProperty({ example: '9ae3...' })
  id: string;

  @ApiProperty({ example: 'PSM' })
  programCode: string;

  @ApiProperty({
    example: 'Profesyonel Scrum Yöneticisi',
    description:
      'Title resolved into the requested locale. Falls back to English if the requested locale has no translation.',
  })
  title: string;

  @ApiProperty({ example: 'Foundational Scrum certification…', nullable: true })
  description: string | null;

  @ApiProperty({ example: '49.00' })
  price: string;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ example: 'https://cdn.ios-lms.com/media/thumbnails/psm.jpg', nullable: true })
  thumbnailUrl: string | null;

  @ApiProperty({ example: true })
  active: boolean;

  @ApiProperty({ example: 'tr' })
  locale: string;

  @ApiProperty({ example: 'ltr', enum: ['ltr', 'rtl'] })
  direction: 'ltr' | 'rtl';

  @ApiProperty({
    example: false,
    description: 'True when this row was rendered from the English fallback because the requested locale had no translation.',
  })
  fallbackUsed: boolean;

  @ApiProperty({ example: '2026-05-19T08:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-05-20T08:30:00.000Z' })
  updatedAt: string;
}

export class CatalogDetailDto extends CatalogItemDto {
  @ApiPropertyOptional({
    description:
      'On admin requests, the raw translations JSONB is included for the matrix UI. Public requests do NOT include this.',
    type: 'object',
    additionalProperties: { type: 'object' },
  })
  translations?: Record<string, Record<string, string>>;
}

export class PaginationMetaDto {
  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({
    example: 'eyJ0cyI6IjIwMjYtMDUtMTlUMDg6MzA6MDAuMDAwWiIsImlkIjoiOWFlMyJ9',
    nullable: true,
  })
  nextCursor: string | null;

  @ApiProperty({ example: true })
  hasMore: boolean;
}

export class CatalogListMetaDto {
  @ApiProperty({ example: 'tr' })
  locale: string;

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;
}

export class CatalogListResponseDto {
  @ApiProperty({ type: [CatalogItemDto] })
  data: CatalogItemDto[];

  @ApiProperty({ type: CatalogListMetaDto })
  meta: CatalogListMetaDto;
}

export class CatalogDetailResponseDto {
  @ApiProperty({ type: CatalogDetailDto })
  data: CatalogDetailDto;

  @ApiProperty({ example: { locale: 'tr' } })
  meta: { locale: string };
}
