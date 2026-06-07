/**
 * Shared i18n types — referenced by TypeORM entities, DTOs, services, and the
 * exception layer. Keep dependency-free so entity imports stay shallow.
 */

/**
 * The six supported locales for the IOS LMS. Locked by the architecture study
 * (§1) and enforced at the DB layer by CHECK constraints on `users.locale` and
 * `admin_users.locale`. Arabic implies RTL on user-facing surfaces.
 */
export const SUPPORTED_LOCALES = [
  'en',
  'tr',
  'fr',
  'es',
  'ar',
  'de',
] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export const RTL_LOCALES: ReadonlySet<Locale> = new Set(['ar']);

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

export function directionFor(locale: Locale): 'ltr' | 'rtl' {
  return RTL_LOCALES.has(locale) ? 'rtl' : 'ltr';
}

/**
 * Shape stored in the `translations` JSONB column.
 *
 *   { "en": { "title": "...", "description": "..." },
 *     "tr": { "title": "...", "description": "..." },
 *     ... }
 *
 * Generic parameter `K` is the set of translatable field keys for a given
 * entity (e.g. `'title' | 'description'`). When the consumer doesn't care
 * about narrowing, `Translations` (with default `string` keys) works as a
 * loose record.
 */
export type Translations<K extends string = string> = Partial<
  Record<Locale, Partial<Record<K, string>>>
>;

/**
 * Resolves a single translatable field for a given locale, falling through
 * the supported locale chain ending at the default. Returns `null` if no
 * locale has populated the field — callers decide whether that's an error
 * or merely a missing-content state.
 */
export function resolveTranslation<K extends string>(
  translations: Translations<K> | null | undefined,
  field: K,
  locale: Locale,
): { value: string | null; localeUsed: Locale | null; fallbackUsed: boolean } {
  if (!translations) return { value: null, localeUsed: null, fallbackUsed: false };

  const direct = translations[locale]?.[field];
  if (direct != null && direct !== '') {
    return { value: direct, localeUsed: locale, fallbackUsed: false };
  }

  const fallback = translations[DEFAULT_LOCALE]?.[field];
  if (fallback != null && fallback !== '') {
    return { value: fallback, localeUsed: DEFAULT_LOCALE, fallbackUsed: true };
  }

  return { value: null, localeUsed: null, fallbackUsed: false };
}
