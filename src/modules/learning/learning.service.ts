import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryRunner } from 'typeorm';
import { I18nContext } from 'nestjs-i18n';
import {
  Certificate,
  LearningModule,
  Lesson,
  StudentProgress,
  StudentPurchase,
} from '../../database/entities';
import {
  DEFAULT_LOCALE,
  Locale,
  Translations,
  directionFor,
  isLocale,
  resolveTranslation,
} from '../../common/i18n/types';
import { StorageService } from '../storage/storage.service';
import { BucketKind } from '../storage/storage.types';
import {
  CreateModuleDto,
  ModuleLocaleDto,
  UpdateModuleDto,
} from './dto/module.dtos';
import {
  CreateLessonDto,
  LessonLocaleDto,
  UpdateLessonDto,
} from './dto/lesson.dtos';

const VIDEO_SIGNED_URL_TTL_SEC = 60 * 60; // 1h is enough for one viewing pass

@Injectable()
export class LearningService {
  constructor(
    @InjectRepository(Certificate)
    private readonly certificates: Repository<Certificate>,
    @InjectRepository(LearningModule)
    private readonly modules: Repository<LearningModule>,
    @InjectRepository(Lesson)
    private readonly lessons: Repository<Lesson>,
    @InjectRepository(StudentProgress)
    private readonly progress: Repository<StudentProgress>,
    private readonly storage: StorageService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────
  // Admin — module CRUD
  // ─────────────────────────────────────────────────────────────────────

  async createModule(dto: CreateModuleDto) {
    const cert = await this.certificates.findOne({
      where: { id: dto.certId },
      select: ['id'],
    });
    if (!cert) throw new NotFoundException('Parent certificate not found');

    const translations = this.buildTranslations({
      existing: {},
      dtoTranslations: dto.translations,
      canonicalTitle: dto.title,
      canonicalBody: dto.description ?? null,
      bodyKey: 'description',
    });

    const saved = await this.modules.save(
      this.modules.create({
        certId: dto.certId,
        title: dto.title,
        description: dto.description ?? null,
        position: dto.position ?? 0,
        active: dto.active ?? true,
        translations,
      }),
    );
    return this.adminModuleDto(saved);
  }

  async updateModule(id: string, dto: UpdateModuleDto) {
    const mod = await this.modules.findOne({ where: { id } });
    if (!mod) throw new NotFoundException('Module not found');

    const patch: Partial<LearningModule> = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.position !== undefined) patch.position = dto.position;
    if (dto.active !== undefined) patch.active = dto.active;

    const canonicalChanged =
      dto.title !== undefined || dto.description !== undefined;
    if (canonicalChanged || dto.translations !== undefined) {
      patch.translations = this.buildTranslations({
        existing:
          (mod.translations as Record<string, ModuleLocaleDto>) ?? {},
        dtoTranslations: dto.translations,
        canonicalTitle: dto.title ?? mod.title,
        canonicalBody:
          dto.description !== undefined ? dto.description : mod.description,
        bodyKey: 'description',
      });
    }

    if (Object.keys(patch).length > 0) {
      await this.modules.update({ id }, patch);
    }
    return this.adminModuleDto(await this.modules.findOneOrFail({ where: { id } }));
  }

  async softDeleteModule(id: string) {
    const mod = await this.modules.findOne({ where: { id }, select: ['id'] });
    if (!mod) throw new NotFoundException('Module not found');
    await this.modules.update({ id }, { active: false });
    return { id, active: false as const };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Admin — lesson CRUD
  // ─────────────────────────────────────────────────────────────────────

  async createLesson(dto: CreateLessonDto) {
    const mod = await this.modules.findOne({
      where: { id: dto.moduleId },
      select: ['id'],
    });
    if (!mod) throw new NotFoundException('Parent module not found');

    const translations = this.buildTranslations({
      existing: {},
      dtoTranslations: dto.translations,
      canonicalTitle: dto.title,
      canonicalBody: dto.contentText ?? null,
      bodyKey: 'content_html',
    });

    const saved = await this.lessons.save(
      this.lessons.create({
        moduleId: dto.moduleId,
        title: dto.title,
        contentText: dto.contentText ?? null,
        videoUrl: dto.videoUrl ?? null,
        position: dto.position ?? 0,
        durationSeconds: dto.durationSeconds ?? null,
        active: dto.active ?? true,
        translations,
      }),
    );
    return this.adminLessonDto(saved);
  }

  async updateLesson(id: string, dto: UpdateLessonDto) {
    const lesson = await this.lessons.findOne({ where: { id } });
    if (!lesson) throw new NotFoundException('Lesson not found');

    const patch: Partial<Lesson> = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.contentText !== undefined) patch.contentText = dto.contentText;
    if (dto.videoUrl !== undefined) patch.videoUrl = dto.videoUrl;
    if (dto.position !== undefined) patch.position = dto.position;
    if (dto.durationSeconds !== undefined)
      patch.durationSeconds = dto.durationSeconds;
    if (dto.active !== undefined) patch.active = dto.active;

    const canonicalChanged =
      dto.title !== undefined || dto.contentText !== undefined;
    if (canonicalChanged || dto.translations !== undefined) {
      patch.translations = this.buildTranslations({
        existing:
          (lesson.translations as Record<string, LessonLocaleDto>) ?? {},
        dtoTranslations: dto.translations,
        canonicalTitle: dto.title ?? lesson.title,
        canonicalBody:
          dto.contentText !== undefined ? dto.contentText : lesson.contentText,
        bodyKey: 'content_html',
      });
    }

    if (Object.keys(patch).length > 0) {
      await this.lessons.update({ id }, patch);
    }
    return this.adminLessonDto(
      await this.lessons.findOneOrFail({ where: { id } }),
    );
  }

  async softDeleteLesson(id: string) {
    const lesson = await this.lessons.findOne({ where: { id }, select: ['id'] });
    if (!lesson) throw new NotFoundException('Lesson not found');
    await this.lessons.update({ id }, { active: false });
    return { id, active: false as const };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Student — curriculum + lesson serving + progress
  // ─────────────────────────────────────────────────────────────────────

  async getCurriculum(
    userId: string,
    certId: string,
    rlsRunner: QueryRunner | undefined,
  ) {
    const cert = await this.certificates.findOne({ where: { id: certId } });
    if (!cert || !cert.active) {
      throw new NotFoundException('Certificate not found');
    }
    await this.assertPurchased(userId, certId, rlsRunner);

    const modules = await this.modules.find({
      where: { certId, active: true },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
    const moduleIds = modules.map((m) => m.id);
    const lessons = moduleIds.length
      ? await this.lessons.find({
          where: moduleIds.map((mid) => ({ moduleId: mid, active: true })),
          order: { position: 'ASC', createdAt: 'ASC' },
        })
      : [];

    const completedIds = await this.progress
      .find({ where: { userId } })
      .then((rows) => new Set(rows.map((r) => r.lessonId)));

    const locale = this.resolveLocale();
    return {
      data: {
        certificate: {
          id: cert.id,
          programCode: cert.programCode,
          title:
            resolveTranslation(cert.translations, 'title', locale).value ??
            cert.title,
        },
        modules: modules.map((m) => ({
          id: m.id,
          title:
            resolveTranslation(m.translations, 'title', locale).value ??
            m.title,
          position: m.position,
          lessons: lessons
            .filter((l) => l.moduleId === m.id)
            .map((l) => ({
              id: l.id,
              title:
                resolveTranslation(l.translations, 'title', locale).value ??
                l.title,
              position: l.position,
              durationSeconds: l.durationSeconds,
              hasVideo: !!l.videoUrl,
              completed: completedIds.has(l.id),
            })),
        })),
      },
      meta: { locale, direction: directionFor(locale) },
    };
  }

  async serveLesson(
    userId: string,
    lessonId: string,
    rlsRunner: QueryRunner | undefined,
  ) {
    const lesson = await this.lessons.findOne({ where: { id: lessonId } });
    if (!lesson || !lesson.active) {
      throw new NotFoundException('Lesson not found');
    }
    const mod = await this.modules.findOne({ where: { id: lesson.moduleId } });
    if (!mod) {
      // Inconsistent state — module deleted but lesson remains. Treat as 404.
      throw new NotFoundException('Lesson not found');
    }
    await this.assertPurchased(userId, mod.certId, rlsRunner);

    const completed = await this.progress.findOne({
      where: { userId, lessonId },
      select: ['id', 'completedAt'],
    });

    const locale = this.resolveLocale();
    const titleRes = resolveTranslation(lesson.translations, 'title', locale);
    const bodyRes = resolveTranslation(
      lesson.translations as Translations<'title' | 'content_html'> | undefined,
      'content_html',
      locale,
    );

    // Lesson videos live in the private VIDEOS bucket — mint a short-lived
    // signed URL on every read so the URL can't be cached and shared.
    let signedVideoUrl: string | null = null;
    if (lesson.videoUrl) {
      signedVideoUrl = await this.storage.getSignedUrl(
        BucketKind.VIDEOS,
        lesson.videoUrl,
        { expiresInSeconds: VIDEO_SIGNED_URL_TTL_SEC },
      );
    }

    return {
      data: {
        id: lesson.id,
        moduleId: lesson.moduleId,
        title: titleRes.value ?? lesson.title,
        contentHtml: bodyRes.value ?? lesson.contentText,
        videoUrl: signedVideoUrl,
        durationSeconds: lesson.durationSeconds,
        position: lesson.position,
        completed: !!completed,
        completedAt: completed?.completedAt?.toISOString() ?? null,
      },
      meta: {
        locale,
        direction: directionFor(locale),
        fallbackUsed: titleRes.fallbackUsed || bodyRes.fallbackUsed,
        videoUrlExpiresInSeconds: signedVideoUrl ? VIDEO_SIGNED_URL_TTL_SEC : null,
      },
    };
  }

  async markComplete(userId: string, lessonId: string, rlsRunner: QueryRunner | undefined) {
    const lesson = await this.lessons.findOne({ where: { id: lessonId } });
    if (!lesson || !lesson.active) {
      throw new NotFoundException('Lesson not found');
    }
    const mod = await this.modules.findOne({ where: { id: lesson.moduleId } });
    if (!mod) throw new NotFoundException('Lesson not found');
    await this.assertPurchased(userId, mod.certId, rlsRunner);

    // Idempotent upsert — re-marking complete is a no-op (no change to
    // completedAt). Uses the unique (user_id, lesson_id) constraint.
    const existing = await this.progress.findOne({
      where: { userId, lessonId },
    });
    if (existing) {
      return {
        data: {
          lessonId,
          completedAt: existing.completedAt.toISOString(),
          alreadyCompleted: true,
        },
      };
    }

    const saved = await this.progress.save(
      this.progress.create({
        userId,
        lessonId,
        completedAt: new Date(),
      }),
    );
    return {
      data: {
        lessonId,
        completedAt: saved.completedAt.toISOString(),
        alreadyCompleted: false,
      },
    };
  }

  /**
   * Per-cert progress summary for `GET /me/progress`. RLS-protected
   * `student_purchases` is queried through the rlsRunner so the user can
   * only see their own enrolments. Non-RLS tables (modules, lessons, progress)
   * use the regular pool with an explicit `userId =` filter for progress.
   */
  async getProgressSummary(userId: string, rlsRunner: QueryRunner | undefined) {
    const purchases = await this.findPurchases(userId, rlsRunner);
    if (purchases.length === 0) {
      return { data: [], meta: { locale: this.resolveLocale() } };
    }

    const certIds = purchases.map((p) => p.certId);
    const certs = await this.certificates.find({
      where: certIds.map((id) => ({ id })),
    });
    const modules = await this.modules.find({
      where: certIds.map((id) => ({ certId: id, active: true })),
    });
    const moduleIds = modules.map((m) => m.id);
    const lessons = moduleIds.length
      ? await this.lessons.find({
          where: moduleIds.map((mid) => ({ moduleId: mid, active: true })),
        })
      : [];
    const completed = await this.progress.find({ where: { userId } });
    const completedSet = new Set(completed.map((c) => c.lessonId));

    const locale = this.resolveLocale();
    const data = certs.map((cert) => {
      const certModuleIds = modules
        .filter((m) => m.certId === cert.id)
        .map((m) => m.id);
      const certLessons = lessons.filter((l) =>
        certModuleIds.includes(l.moduleId),
      );
      const completedCount = certLessons.filter((l) =>
        completedSet.has(l.id),
      ).length;
      return {
        certId: cert.id,
        programCode: cert.programCode,
        title:
          resolveTranslation(cert.translations, 'title', locale).value ??
          cert.title,
        totalLessons: certLessons.length,
        completedLessons: completedCount,
        percentComplete:
          certLessons.length === 0
            ? 0
            : Math.round((completedCount / certLessons.length) * 100),
      };
    });

    return { data, meta: { locale } };
  }

  // ── Internals ────────────────────────────────────────────────────────

  /**
   * Throws ForbiddenException if the student doesn't own a purchase for
   * the given cert. Runs against the RLS-aware connection if available so
   * defence-in-depth holds.
   */
  private async assertPurchased(
    userId: string,
    certId: string,
    rlsRunner: QueryRunner | undefined,
  ): Promise<void> {
    const rows = rlsRunner
      ? await rlsRunner.manager
          .getRepository(StudentPurchase)
          .find({ where: { userId, certId }, take: 1 })
      : await this.fallbackPurchaseLookup(userId, certId);
    if (rows.length === 0) {
      throw new ForbiddenException('You have not enrolled in this certificate');
    }
  }

  private async findPurchases(
    userId: string,
    rlsRunner: QueryRunner | undefined,
  ): Promise<StudentPurchase[]> {
    if (rlsRunner) {
      return rlsRunner.manager
        .getRepository(StudentPurchase)
        .find({ where: { userId } });
    }
    return this.fallbackPurchaseLookupAll(userId);
  }

  /**
   * Fallback for unauthenticated tests / non-request-scoped callers. RLS will
   * still apply if the connecting role is non-superuser; in that case the
   * query returns nothing (the WHERE filter matches by hand for free).
   */
  private async fallbackPurchaseLookup(
    userId: string,
    certId: string,
  ): Promise<StudentPurchase[]> {
    return this.certificates.manager
      .getRepository(StudentPurchase)
      .find({ where: { userId, certId }, take: 1 });
  }

  private async fallbackPurchaseLookupAll(
    userId: string,
  ): Promise<StudentPurchase[]> {
    return this.certificates.manager
      .getRepository(StudentPurchase)
      .find({ where: { userId } });
  }

  private resolveLocale(): Locale {
    const ctx = I18nContext.current();
    const raw = ctx?.lang ?? DEFAULT_LOCALE;
    return isLocale(raw) ? raw : DEFAULT_LOCALE;
  }

  private adminModuleDto(m: LearningModule) {
    return {
      id: m.id,
      certId: m.certId,
      title: m.title,
      description: m.description,
      position: m.position,
      active: m.active,
      translations: m.translations,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    };
  }

  private adminLessonDto(l: Lesson) {
    return {
      id: l.id,
      moduleId: l.moduleId,
      title: l.title,
      contentText: l.contentText,
      videoUrl: l.videoUrl,
      position: l.position,
      durationSeconds: l.durationSeconds,
      active: l.active,
      translations: l.translations,
      createdAt: l.createdAt.toISOString(),
      updatedAt: l.updatedAt.toISOString(),
    };
  }

  /**
   * Build the resulting `translations` JSONB for create + update. Same
   * semantics as `CatalogService.buildTranslations` — see that file for the
   * full layering rules. Generalised here so lessons (which use `content_html`
   * as the body field) and modules (which use `description`) share one
   * implementation.
   *
   * Rule: if the dto did NOT explicitly supply `translations.en`, force `en`
   * to mirror the canonical title/body so a `PATCH { title: "X" }` keeps the
   * English entry in lockstep with the column.
   */
  private buildTranslations(args: {
    existing: Record<string, Record<string, string>>;
    dtoTranslations?: Record<string, Record<string, string>>;
    canonicalTitle: string;
    canonicalBody: string | null;
    bodyKey: 'description' | 'content_html';
  }): Record<string, Record<string, string>> {
    const dtoT = args.dtoTranslations ?? {};
    const explicitEn = Object.prototype.hasOwnProperty.call(dtoT, 'en');

    const merged: Record<string, Record<string, string>> = { ...args.existing };
    for (const [locale, block] of Object.entries(dtoT)) {
      merged[locale] = block;
    }

    if (!explicitEn) {
      const enBlock: Record<string, string> = { title: args.canonicalTitle };
      if (args.canonicalBody != null) {
        enBlock[args.bodyKey] = args.canonicalBody;
      }
      merged.en = enBlock;
    }
    return merged;
  }
}
