import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../database/entities';
import {
  Locale,
  directionFor,
  isLocale,
} from '../../common/i18n/types';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileResponseDto } from './dto/profile-response.dto';

/**
 * Owns the non-password slice of the authenticated user's profile.
 *
 * Password change is delegated to `AuthService.changePassword()` because the
 * mechanics (bcrypt, refresh-token revocation) already live there — keeping
 * those concerns in one module prevents drift.
 */
@Injectable()
export class ProfileService {
  /**
   * Fields a student can edit through `PATCH /me`. Anything not in this list
   * is silently dropped from the update — defence in depth on top of the DTO's
   * `forbidNonWhitelisted` pipe so even a swapped-in malicious DTO can't move
   * `email_verified`, `active`, or `password_hash`.
   */
  private static readonly UPDATABLE_FIELDS: ReadonlyArray<keyof UpdateProfileDto> =
    [
      'firstName',
      'lastName',
      'phone',
      'locale',
      'country',
      'city',
      'street',
      'address',
      'postalCode',
      'occupation',
      'position',
      'company',
      'avatarUrl',
    ];

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async getProfile(userId: string): Promise<ProfileResponseDto> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Profile not found');
    }
    return this.toResponseDto(user);
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<ProfileResponseDto> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Profile not found');
    }

    // Apply only the allowlisted fields. Each field uses `hasOwnProperty` so
    // explicit `null` values still propagate (clearing optional fields), while
    // undefined keys are skipped (no-op).
    const patch: Partial<User> = {};
    for (const field of ProfileService.UPDATABLE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(dto, field)) {
        const value = (dto as Record<string, unknown>)[field];
        (patch as Record<string, unknown>)[field] = value;
      }
    }

    if (Object.keys(patch).length === 0) {
      // No-op — return current state without touching DB.
      return this.toResponseDto(user);
    }

    await this.users.update({ id: userId }, patch as any);
    const refreshed = await this.users.findOneOrFail({ where: { id: userId } });
    return this.toResponseDto(refreshed);
  }

  private toResponseDto(user: User): ProfileResponseDto {
    const locale: Locale = isLocale(user.locale) ? user.locale : 'en';
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: user.fullName,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      country: user.country,
      city: user.city,
      street: user.street,
      address: user.address,
      postalCode: user.postalCode,
      occupation: user.occupation,
      position: user.position,
      company: user.company,
      locale,
      direction: directionFor(locale),
      emailVerified: user.emailVerified,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }
}
