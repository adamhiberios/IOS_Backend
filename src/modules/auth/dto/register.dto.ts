import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  // ── Required ──────────────────────────────────────────────────────────

  @ApiProperty({
    example: 'student@example.com',
    description: 'Email address (unique)',
  })
  @IsEmail({}, { message: 'Email must be a valid email address' })
  @MaxLength(255)
  email: string;

  @ApiProperty({
    example: 'StrongP@ssw0rd',
    description:
      'Min 8 chars, at least one uppercase, one lowercase, one digit, one special character',
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/, {
    message:
      'Password must contain uppercase, lowercase, digit, and special character',
  })
  password: string;

  @ApiProperty({ example: 'Jane' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;

  // ── Optional personal ─────────────────────────────────────────────────

  @ApiProperty({ example: '+1 415 555 0100', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiProperty({ example: 'en', required: false, default: 'en' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  // ── Optional location ─────────────────────────────────────────────────

  @ApiProperty({ example: 'Canada', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @ApiProperty({ example: 'Victoria', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiProperty({ example: 'Blanshard', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  street?: string;

  @ApiProperty({ example: '1234 Blanshard St', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @ApiProperty({ example: 'V8W 3J6', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  // ── Optional professional ─────────────────────────────────────────────

  @ApiProperty({ example: 'Graphic designer', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  occupation?: string;

  @ApiProperty({ example: 'Team lead', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  position?: string;

  @ApiProperty({ example: 'Acme Inc.', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  company?: string;
}
