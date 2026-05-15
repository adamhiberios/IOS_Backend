import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// ── Login ────────────────────────────────────────────────────────────────────

export class LoginDto {
  @ApiProperty({ example: 'admin@ios.local' })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({ example: 'DevAdmin@123!' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}

// ── Verify email ─────────────────────────────────────────────────────────────

export class VerifyEmailDto {
  @ApiProperty({
    example: 'a1b2c3d4...',
    description: '64-char hex token from verification email',
  })
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  token: string;
}

// ── Forgot password ──────────────────────────────────────────────────────────

export class ForgotPasswordDto {
  @ApiProperty({ example: 'student@example.com' })
  @IsEmail()
  @MaxLength(255)
  email: string;
}

// ── Reset password ───────────────────────────────────────────────────────────

export class ResetPasswordDto {
  @ApiProperty({
    example: 'a1b2c3d4...',
    description: '64-char hex token from reset email',
  })
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  token: string;

  @ApiProperty({
    example: 'NewStrongP@ssw0rd',
    description: 'Same complexity rules as registration password',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/, {
    message:
      'Password must contain uppercase, lowercase, digit, and special character',
  })
  newPassword: string;
}
