import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SUPPORTED_LOCALES } from '../../../common/i18n/types';

/**
 * Body for `PATCH /me`. Every field is optional — only the supplied keys are
 * applied. Email is intentionally NOT mutable here (a separate flow with
 * reverification will land in Week 8). Password is its own endpoint.
 */
export class UpdateProfileDto {
  @ApiProperty({ example: 'Jane', required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string;

  @ApiProperty({ example: 'Doe', required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName?: string;

  @ApiProperty({ example: '+1 415 555 0100', required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string | null;

  @ApiProperty({
    example: 'tr',
    required: false,
    description: 'Preferred UI/notification locale. One of the supported set.',
  })
  @IsOptional()
  @IsIn(SUPPORTED_LOCALES as readonly string[])
  locale?: string;

  @ApiProperty({ example: 'Canada', required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string | null;

  @ApiProperty({ example: 'Victoria', required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string | null;

  @ApiProperty({ example: 'Blanshard', required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  street?: string | null;

  @ApiProperty({ example: '1234 Blanshard St', required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string | null;

  @ApiProperty({ example: 'V8W 3J6', required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string | null;

  @ApiProperty({ example: 'Graphic designer', required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  occupation?: string | null;

  @ApiProperty({ example: 'Team lead', required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  position?: string | null;

  @ApiProperty({ example: 'Acme Inc.', required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  company?: string | null;

  @ApiProperty({
    example: 'https://cdn.ios-lms.com/media/avatars/users/abc.jpg',
    required: false,
    nullable: true,
    description:
      'URL of the uploaded avatar in the media bucket. Set to null to clear.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatarUrl?: string | null;
}
