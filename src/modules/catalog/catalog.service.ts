import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { I18nContext } from 'nestjs-i18n';
import { Certificate } from '../../database/entities';
import {
  DEFAULT_LOCALE,
  Locale,
  directionFor,
  isLocale,
  resolveTranslation,
} from '../../common/i18n/types';
import { CatalogQueryDto } from './dto/catalog-query.dto';
import {
  CreateCertificateDto,
  CertificateLocaleDto,
} from './dto/create-certificate.dto';
import { UpdateCertificateDto } from './dto/update-certificate.dto';
import {
  CatalogDetailDto,
  CatalogItemDto,
  CatalogListResponseDto,
} from './dto/catalog-response.dto';

interface DecodedCursor {
  ts: string;
  id: string;
}

@Injectable()
export class CatalogService {
  static readonly DEFAULT_LIMIT = 20;
  static readonly MAX_LIMIT = 100;

  constructor(
    @InjectRepository(Certificate)
    private readonly certificates: Repository<Certificate>,
  ) {}

  // ── Public read API ───────────────────────────────────────────────────

  async list(
    query: CatalogQueryDto,
    opts: { adminView?: boolean } = {},
  ): Promise<CatalogListResponseDto> {
    const locale = this.resolveLocale();
    const limit = Math.min(
      query.limit ?? CatalogService.DEFAULT_LIMIT,
      CatalogService.MAX_LIMIT,
    );
    const sort: '-created_at' | 'created_at' = query.sort ?? '-created_at';
    const direction = sort.startsWith('-') ? 'DESC' : 'ASC';

    const qb = this.certificates.createQueryBuilder('c');

    // Public endpoint defaults to active=true; admin endpoint passes through
    // whatever the caller set (or no filter when omitted).
    if (opts.adminView) {
      if (query.active !== undefined) qb.andWhere('c.active = :a', { a: query.active });
    } else {
      qb.andWhere('c.active = :a', { a: query.active ?? true });
    }

    if (query.program_code) {
      qb.andWhere('c.program_code = :pc', { pc: query.program_code });
    }

    if (query.search) {
      // Trigram match against the canonical English title — the GIN index
      // shipped in migration 1748000000000-AddI18nSupport powers this. If we
      // later want multi-locale search, add equivalent indexes per locale and
      // OR them in here.
      qb.andWhere(
        `(c.translations -> 'en' ->> 'title') ILIKE :s OR c.title ILIKE :s`,
        { s: `%${query.search}%` },
      );
    }

    if (query.cursor) {
      const decoded = this.decodeCursor(query.cursor);
      // For DESC we want rows with (created_at, id) < cursor
      // For ASC  we want rows with (created_at, id) > cursor
      const op = direction === 'DESC' ? '<' : '>';
      qb.andWhere(
        `(c.created_at, c.id::text) ${op} (:ts, :id)`,
        { ts: decoded.ts, id: decoded.id },
      );
    }

    qb.orderBy('c.created_at', direction).addOrderBy('c.id', direction);
    qb.take(limit + 1); // fetch one extra to detect "has_more"

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const data = page.map((c) => this.toItemDto(c, locale));
    const nextCursor =
      hasMore && page.length > 0
        ? this.encodeCursor({
            ts: page[page.length - 1].createdAt.toISOString(),
            id: page[page.length - 1].id,
          })
        : null;

    return {
      data,
      meta: {
        locale,
        pagination: { limit, nextCursor, hasMore },
      },
    };
  }

  async getById(
    id: string,
    opts: { adminView?: boolean } = {},
  ): Promise<{ data: CatalogDetailDto; meta: { locale: string } }> {
    const locale = this.resolveLocale();
    const cert = await this.certificates.findOne({ where: { id } });
    if (!cert) {
      throw new NotFoundException('Certificate not found');
    }
    if (!opts.adminView && !cert.active) {
      // Public endpoint hides inactive certs as if they don't exist (avoids
      // leaking the existence of soft-deleted catalog entries).
      throw new NotFoundException('Certificate not found');
    }

    const dto = this.toDetailDto(cert, locale, opts.adminView ?? false);
    return { data: dto, meta: { locale } };
  }

  // ── Admin write API ───────────────────────────────────────────────────

  async create(dto: CreateCertificateDto): Promise<CatalogDetailDto> {
    const existing = await this.certificates.findOne({
      where: { programCode: dto.programCode },
      select: ['id'],
    });
    if (existing) {
      throw new ConflictException(
        `A certificate with program code '${dto.programCode}' already exists`,
      );
    }

    const translations = this.buildTranslations({
      existing: {},
      dtoTranslations: dto.translations,
      canonicalTitle: dto.title,
      canonicalDescription: dto.description ?? null,
    });

    const saved = await this.certificates.save(
      this.certificates.create({
        title: dto.title,
        programCode: dto.programCode,
        price: dto.price,
        currency: dto.currency ?? 'USD',
        description: dto.description ?? null,
        thumbnailUrl: dto.thumbnailUrl ?? null,
        active: dto.active ?? true,
        translations,
      }),
    );

    return this.toDetailDto(saved, this.resolveLocale(), true);
  }

  async update(
    id: string,
    dto: UpdateCertificateDto,
  ): Promise<CatalogDetailDto> {
    const cert = await this.certificates.findOne({ where: { id } });
    if (!cert) {
      throw new NotFoundException('Certificate not found');
    }

    if (dto.programCode && dto.programCode !== cert.programCode) {
      const clash = await this.certificates.findOne({
        where: { programCode: dto.programCode },
        select: ['id'],
      });
      if (clash && clash.id !== id) {
        throw new ConflictException(
          `A certificate with program code '${dto.programCode}' already exists`,
        );
      }
    }

    const patch: Partial<Certificate> = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.programCode !== undefined) patch.programCode = dto.programCode;
    if (dto.price !== undefined) patch.price = dto.price;
    if (dto.currency !== undefined) patch.currency = dto.currency;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.thumbnailUrl !== undefined) patch.thumbnailUrl = dto.thumbnailUrl;
    if (dto.active !== undefined) patch.active = dto.active;

    // Translations get rebuilt iff:
    //   - the canonical title/description changed (we need to mirror new
    //     canonical into `translations.en`), or
    //   - the dto explicitly provided a translations block (admin authored
    //     non-English content).
    const canonicalChanged =
      dto.title !== undefined || dto.description !== undefined;
    if (canonicalChanged || dto.translations !== undefined) {
      patch.translations = this.buildTranslations({
        existing:
          (cert.translations as Record<string, CertificateLocaleDto>) ?? {},
        dtoTranslations: dto.translations,
        canonicalTitle: dto.title ?? cert.title,
        canonicalDescription:
          (dto.description !== undefined ? dto.description : cert.description) ?? null,
      });
    }

    if (Object.keys(patch).length > 0) {
      await this.certificates.update({ id }, patch as any);
    }
    const refreshed = await this.certificates.findOneOrFail({ where: { id } });
    return this.toDetailDto(refreshed, this.resolveLocale(), true);
  }

  async updateTranslations(
    id: string,
    incoming: Record<string, CertificateLocaleDto>,
  ): Promise<CatalogDetailDto> {
    const cert = await this.certificates.findOne({ where: { id } });
    if (!cert) {
      throw new NotFoundException('Certificate not found');
    }

    // Validate every supplied locale key. Reject the entire request on a bad
    // key — don't silently drop, the caller probably has a bug.
    for (const key of Object.keys(incoming)) {
      if (!isLocale(key)) {
        throw new BadRequestException(`Unsupported locale: '${key}'`);
      }
    }

    // Shallow merge: each supplied locale entry replaces the existing entry
    // for that locale. Locales not present in `incoming` are preserved.
    const merged: Record<string, CertificateLocaleDto> = {
      ...(cert.translations as Record<string, CertificateLocaleDto> ?? {}),
      ...incoming,
    };

    // Keep `en.title` aligned to the canonical column.
    if (merged.en?.title && merged.en.title !== cert.title) {
      // Admin chose to override canonical via translations — accept it.
      await this.certificates.update(
        { id },
        { title: merged.en.title, translations: merged } as any,
      );
    } else {
      await this.certificates.update({ id }, { translations: merged } as any);
    }

    const refreshed = await this.certificates.findOneOrFail({ where: { id } });
    return this.toDetailDto(refreshed, this.resolveLocale(), true);
  }

  async softDelete(id: string): Promise<{ id: string; active: false }> {
    const cert = await this.certificates.findOne({ where: { id } });
    if (!cert) {
      throw new NotFoundException('Certificate not found');
    }
    await this.certificates.update({ id }, { active: false });
    return { id, active: false };
  }

  // ── Internals ────────────────────────────────────────────────────────

  private resolveLocale(): Locale {
    const ctx = I18nContext.current();
    const raw = ctx?.lang ?? DEFAULT_LOCALE;
    return isLocale(raw) ? raw : DEFAULT_LOCALE;
  }

  private toItemDto(c: Certificate, locale: Locale): CatalogItemDto {
    const titleRes = resolveTranslation(
      c.translations,
      'title',
      locale,
    );
    const descRes = resolveTranslation(
      c.translations,
      'description',
      locale,
    );

    return {
      id: c.id,
      programCode: c.programCode,
      title: titleRes.value ?? c.title,
      description: (descRes.value ?? c.description) ?? null,
      price: this.formatPrice(c.price),
      currency: c.currency,
      thumbnailUrl: c.thumbnailUrl ?? null,
      active: c.active,
      locale,
      direction: directionFor(locale),
      fallbackUsed: titleRes.fallbackUsed || descRes.fallbackUsed,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }

  private toDetailDto(
    c: Certificate,
    locale: Locale,
    adminView: boolean,
  ): CatalogDetailDto {
    const base = this.toItemDto(c, locale);
    if (!adminView) return base;
    return {
      ...base,
      translations: (c.translations ?? {}) as Record<
        string,
        Record<string, string>
      >,
    };
  }

  private formatPrice(price: number | string): string {
    const n = typeof price === 'string' ? Number(price) : price;
    return n.toFixed(2);
  }

  /**
   * Build the resulting `translations` JSONB for create + update. Layering:
   *
   *   1. Start with `existing` (the cert's current translations, or {} on create).
   *   2. For every locale present in `dtoTranslations`, REPLACE the existing
   *      block for that locale. Locales not in dto are preserved.
   *   3. If the dto did NOT explicitly supply `translations.en`, force `en`
   *      to mirror the canonical title/description. This is the rule that
   *      lets `PATCH { title: "New" }` keep `translations.en.title` in sync.
   *      When the admin DID supply `translations.en` explicitly, we respect
   *      it — that's the intentional-divergence case (rare).
   */
  private buildTranslations(args: {
    existing: Record<string, CertificateLocaleDto>;
    dtoTranslations?: Record<string, CertificateLocaleDto>;
    canonicalTitle: string;
    canonicalDescription: string | null;
  }): Record<string, CertificateLocaleDto> {
    const dtoT = args.dtoTranslations ?? {};
    const explicitEn = Object.prototype.hasOwnProperty.call(dtoT, 'en');

    const merged: Record<string, CertificateLocaleDto> = { ...args.existing };
    for (const [locale, block] of Object.entries(dtoT)) {
      merged[locale] = block;
    }

    if (!explicitEn) {
      merged.en = {
        title: args.canonicalTitle,
        description: args.canonicalDescription ?? undefined,
      };
    }
    return merged;
  }

  // ── Cursor helpers ───────────────────────────────────────────────────

  private encodeCursor(cursor: DecodedCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  }

  private decodeCursor(raw: string): DecodedCursor {
    try {
      const parsed = JSON.parse(
        Buffer.from(raw, 'base64url').toString('utf8'),
      ) as DecodedCursor;
      if (!parsed.ts || !parsed.id) throw new Error('cursor missing fields');
      return parsed;
    } catch {
      throw new BadRequestException('Invalid cursor');
    }
  }
}
