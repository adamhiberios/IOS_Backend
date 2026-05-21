import * as path from 'path';
import { Module } from '@nestjs/common';
import {
  AcceptLanguageResolver,
  CookieResolver,
  HeaderResolver,
  I18nModule,
  QueryResolver,
} from 'nestjs-i18n';
import { UserPreferenceResolver } from './resolvers/user-preference.resolver';

/**
 * Application-wide i18n wiring. Loads JSON resource bundles from
 * `src/i18n/resources/<locale>/<namespace>.json` (copied to `dist/i18n/resources`
 * at build time via `nest-cli.json` assets config).
 *
 * Resolver chain (highest priority first):
 *   1. HeaderResolver('x-lang') — explicit per-request override (locale
 *      switchers in the UI, admin preview of translations, power-user
 *      cross-locale links). Wins over everything else when present.
 *   2. QueryResolver('lang')    — admin preview links only
 *   3. UserPreferenceResolver   — the authenticated user's stored locale,
 *      pulled from the JWT claim. The default for authenticated requests
 *      when no explicit override is supplied.
 *   4. AcceptLanguageResolver   — browser default for anonymous users
 *   5. CookieResolver('lang')   — last-resort sticky preference
 *
 * Falls back to `DEFAULT_LOCALE` (env-controlled, default `en`) when nothing
 * resolves. Unsupported locales coming from the network are filtered to
 * `undefined` by each resolver — never silently rewritten to `en`.
 *
 * Note on ordering: this differs from the v3 architecture study's first
 * draft (which put UserPreferenceResolver at #1). The change was driven by
 * a real product need surfaced by integration testing — locale switchers
 * and admin previews are useless if user pref always wins. Treat the v3
 * study's §1.3 ordering as superseded by this comment until that doc is
 * amended in the next refresh.
 */
@Module({
  imports: [
    I18nModule.forRoot({
      fallbackLanguage: process.env.DEFAULT_LOCALE ?? 'en',
      loaderOptions: {
        path: path.join(__dirname, 'resources'),
        watch: process.env.NODE_ENV === 'development',
      },
      resolvers: [
        new HeaderResolver(['x-lang']),
        new QueryResolver(['lang']),
        UserPreferenceResolver,
        AcceptLanguageResolver,
        new CookieResolver(['lang']),
      ],
      // Generated types are dev-only — skip on test runs to avoid noisy writes
      // and on prod where the file is shipped pre-generated.
      typesOutputPath:
        process.env.NODE_ENV === 'development'
          ? path.join(process.cwd(), 'src/generated/i18n.generated.ts')
          : undefined,
      logging: process.env.NODE_ENV === 'development',
    }),
  ],
  providers: [UserPreferenceResolver],
  exports: [I18nModule],
})
export class AppI18nModule {}
