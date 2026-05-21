import { ApiProperty } from '@nestjs/swagger';

/**
 * Public profile shape — `password_hash` is never serialised. `fullName` is
 * computed at controller time from `firstName + lastName`.
 */
export class ProfileResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ example: 'student@example.com' })
  email: string;

  @ApiProperty({ example: 'Jane' })
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  lastName: string;

  @ApiProperty({ example: 'Jane Doe' })
  fullName: string;

  @ApiProperty({ example: '+1 415 555 0100', nullable: true })
  phone: string | null;

  @ApiProperty({
    example: 'https://cdn.ios-lms.com/media/avatars/users/abc.jpg',
    nullable: true,
  })
  avatarUrl: string | null;

  @ApiProperty({ example: 'Canada', nullable: true })
  country: string | null;

  @ApiProperty({ example: 'Victoria', nullable: true })
  city: string | null;

  @ApiProperty({ example: 'Blanshard', nullable: true })
  street: string | null;

  @ApiProperty({ example: '1234 Blanshard St', nullable: true })
  address: string | null;

  @ApiProperty({ example: 'V8W 3J6', nullable: true })
  postalCode: string | null;

  @ApiProperty({ example: 'Graphic designer', nullable: true })
  occupation: string | null;

  @ApiProperty({ example: 'Team lead', nullable: true })
  position: string | null;

  @ApiProperty({ example: 'Acme Inc.', nullable: true })
  company: string | null;

  @ApiProperty({ example: 'tr' })
  locale: string;

  @ApiProperty({ example: 'ltr', enum: ['ltr', 'rtl'] })
  direction: 'ltr' | 'rtl';

  @ApiProperty({ example: true })
  emailVerified: boolean;

  @ApiProperty({ example: '2026-05-19T08:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-05-20T10:15:00.000Z' })
  updatedAt: string;
}
