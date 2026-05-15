import { ApiProperty } from '@nestjs/swagger';

export class AuthUserResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ example: 'student@example.com' })
  email: string;

  @ApiProperty({ example: 'Jane' })
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  lastName: string;

  @ApiProperty({
    example: 'Jane Doe',
    description: 'Computed: firstName + lastName',
  })
  fullName: string;

  @ApiProperty({ example: 'en' })
  locale: string;

  @ApiProperty({ example: true })
  emailVerified: boolean;

  @ApiProperty({ example: 'student', enum: ['student', 'admin'] })
  type: 'student' | 'admin';

  @ApiProperty({ example: 'super_admin', required: false, nullable: true })
  role?: string | null;
}

export class LoginResponseDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description:
      'Access token (JWT) — store in memory, send as Authorization: Bearer header',
  })
  accessToken: string;

  @ApiProperty({ example: 900, description: 'Access token TTL in seconds' })
  expiresIn: number;

  @ApiProperty({ type: AuthUserResponseDto })
  user: AuthUserResponseDto;
}

export class MessageResponseDto {
  @ApiProperty({ example: 'Operation completed successfully' })
  message: string;
}

export class RegisterResponseDto extends MessageResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  userId: string;
}
