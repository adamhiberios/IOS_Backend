import {
  DEFAULT_LOCALE,
  Translations,
  directionFor,
  isLocale,
  resolveTranslation,
} from './types';

describe('i18n types helpers', () => {
  describe('isLocale', () => {
    it('accepts every supported locale', () => {
      ['en', 'tr', 'fr', 'es', 'ar', 'de'].forEach((l) =>
        expect(isLocale(l)).toBe(true),
      );
    });

    it('rejects anything outside the supported set', () => {
      expect(isLocale('ja')).toBe(false);
      expect(isLocale('EN')).toBe(false);
      expect(isLocale('')).toBe(false);
      expect(isLocale(undefined)).toBe(false);
      expect(isLocale(123)).toBe(false);
    });
  });

  describe('directionFor', () => {
    it('returns rtl for Arabic', () => {
      expect(directionFor('ar')).toBe('rtl');
    });

    it('returns ltr for every other supported locale', () => {
      ['en', 'tr', 'fr', 'es', 'de'].forEach((l) =>
        expect(directionFor(l as 'en')).toBe('ltr'),
      );
    });
  });

  describe('resolveTranslation', () => {
    const sample: Translations<'title' | 'description'> = {
      en: { title: 'Scrum Master', description: 'Foundational course' },
      tr: { title: 'Scrum Yöneticisi' }, // partial — no description
      ar: { title: 'مدير سكرم' },
    };

    it('returns the requested locale when fully populated', () => {
      const out = resolveTranslation(sample, 'title', 'tr');
      expect(out).toEqual({
        value: 'Scrum Yöneticisi',
        localeUsed: 'tr',
        fallbackUsed: false,
      });
    });

    it('falls back to the default locale when the requested locale is missing the field', () => {
      const out = resolveTranslation(sample, 'description', 'tr');
      expect(out).toEqual({
        value: 'Foundational course',
        localeUsed: DEFAULT_LOCALE,
        fallbackUsed: true,
      });
    });

    it('falls back to the default locale entirely when the requested locale is absent', () => {
      const out = resolveTranslation(sample, 'title', 'fr');
      expect(out.value).toBe('Scrum Master');
      expect(out.fallbackUsed).toBe(true);
    });

    it('returns a null sentinel when no locale has populated the field', () => {
      const empty: Translations<'title'> = {};
      const out = resolveTranslation(empty, 'title', 'tr');
      expect(out).toEqual({ value: null, localeUsed: null, fallbackUsed: false });
    });

    it('treats empty strings as missing', () => {
      const partial: Translations<'title'> = {
        en: { title: '' },
        tr: { title: 'Var' },
      };
      const trOut = resolveTranslation(partial, 'title', 'tr');
      expect(trOut.value).toBe('Var');

      const frOut = resolveTranslation(partial, 'title', 'fr');
      expect(frOut.value).toBeNull();
    });

    it('handles null/undefined input safely', () => {
      expect(resolveTranslation(null, 'title' as never, 'en').value).toBeNull();
      expect(resolveTranslation(undefined, 'title' as never, 'en').value).toBeNull();
    });
  });
});
