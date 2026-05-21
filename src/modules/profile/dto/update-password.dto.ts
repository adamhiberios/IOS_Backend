import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdatePasswordDto {
  @ApiProperty({
    example: 'CurrentP@ssw0rd',
    description: 'Current password — verified against the stored bcrypt hash.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword: string;

  @ApiProperty({
    example: 'NewStr0ngP@ss!',
    description:
      'New password. Same complexity rules as registration: min 8 chars, ' +
      'upper + lower + digit + special. Must differ from currentPassword.',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/, {
    message:
      'New password must contain uppercase, lowercase, digit, and special character',
  })
  newPassword: string;
}
