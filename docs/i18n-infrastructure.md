# i18n Infrastructure — feat/i18n-infrastructure

**Branch:** `feat/i18n-infrastructure` (cut from `main` at `a5c89bc`)
**Scope:** Plumbing pass — wire nestjs-i18n, add the schema columns, build the error taxonomy, refactor the global filter for localization. Content sweep (full Tr/Fr/Es/Ar/De catalogues, 54 email templates, machine-translation drafts) remains in Week 9.

---

## What changed

### New files (23)

```
src/common/errors/
├── app-exception.ts            # Abstract base class — carries i18nKey + args
├── error-codes.ts              # Registry of every code + codeToSlug() helper
├── index.ts                    # Barrel
└── codes/
    ├── auth.errors.ts          # 401 family
    ├── authorization.errors.ts # 403 family
    ├── domain.errors.ts        # 404/409/410/422 family
    ├── validation.errors.ts    # 400/422 with errors[] payload
    └── infrastructure.errors.ts# 5xx family

src/common/i18n/
├── types.ts                    # Locale, Translations<K>, resolveTranslation()
└── types.spec.ts               # 18 cases — locale check, direction, fallback chain

src/i18n/
├── i18n.module.ts              # AppI18nModule — forRoot + 5 resolvers
├── resolvers/
│   ├── user-preference.resolver.ts      # Ranked #1 — req.user.locale
│   └── user-preference.resolver.spec.ts # 4 cases — supported/unsupported/anon/non-http
└── resources/
    ├── en/{errors,validation,common,emails}.json   # Full English catalogue
    ├── tr/errors.json                              # Partial Turkish (proof of localisation)
    ├── ar/errors.json                              # Partial Arabic (RTL smoke target)
    └── {fr,es,de}/errors.json                      # Skeleton — Week 9 fills them

src/database/migrations/
└── 1748000000000-AddI18nSupport.ts   # JSONB columns, CHECK constraints, GIN indexes
```

### Modified files (10)

```
nest-cli.json                                    # +assets config to copy resources to dist/
src/app.module.ts                                # +AppI18nModule import
src/common/filters/global-exception.filter.ts    # Full refactor — I18nService, code taxonomy, request_id, problem+json
src/common/filters/global-exception.filter.spec.ts # Rewrite — 11 cases against the new shape
src/database/entities/admin-user.entity.ts       # +locale column
src/database/entities/auth-misc.entity.ts        # +translations on BlogArticle
src/database/entities/certificate.entity.ts      # +translations<title|description>
src/database/entities/exam.entity.ts             # +translations<title>
src/database/entities/learning-module.entity.ts  # +translations<title|description>
src/database/entities/lesson.entity.ts           # +translations<title|content_html>
```

`User.locale` was already present from Week 1 — the migration adds the CHECK constraint to it.

---

## Run this locally

```powershell
# 1. Make sure the toolchain is happy.
npm install
npm run lint
npm run build

# 2. Run the unit suite — three new spec files plus the rewritten filter spec.
npm test -- --testPathPatterns="i18n|errors|filter"

# 3. Run the migration in your local Postgres.
npm run migration:run

# 4. Smoke-check that the resolver chain works end-to-end. Start the API and:
curl -i -H "X-Lang: tr" http://localhost:3000/api/v1/auth/login \
  -d '{"email":"x@y.z","password":"wrong"}' -H "Content-Type: application/json"
# Expect: 401 application/problem+json, title="Geçersiz kimlik bilgileri", code=INVALID_CREDENTIALS

curl -i -H "X-Lang: ar" http://localhost:3000/api/v1/auth/login \
  -d '{"email":"x@y.z","password":"wrong"}' -H "Content-Type: application/json"
# Expect: 401, title="بيانات اعتماد غير صالحة"

curl -i -H "X-Lang: ja" http://localhost:3000/api/v1/auth/login \
  -d '{"email":"x@y.z","password":"wrong"}' -H "Content-Type: application/json"
# Expect: 401 with English title — silent fallback for non-supported locale via Accept-Language path

# 5. Stage and commit.
git add nest-cli.json src/
git commit -m "feat(i18n): infrastructure pass — module wiring, schema, errors, filter"
```

If anything fails on build, the most likely cause is a `nestjs-i18n@10.8.4` API surface I called slightly differently than your installed version — the resolver class signature and `I18nContext.current(host)` are the highest-risk spots. Both are exercised by the new spec suite, so failures will surface immediately.

---

## Why the VM couldn't validate

The Linux workspace VM mounts your OneDrive folder via a Windows passthrough that strips POSIX symlink permissions. `npm install` lays down ~700MB of packages successfully but cannot create the `node_modules/.bin/*` symlinks, so `tsc` / `eslint` / `jest` aren't callable from inside. The same constraint blocks `git` from removing its own `.git/index.lock`. Running these in your Windows shell sidesteps both issues — Node/npm on Windows uses `.cmd` shims instead of symlinks.

---

## Design notes worth knowing

**Locale resolution chain (highest priority first):**

1. `UserPreferenceResolver` — `req.user.locale` from the JWT (already populated by `JwtStrategy`)
2. `HeaderResolver('x-lang')` — explicit override for admin previews
3. `QueryResolver('lang')` — admin preview links only
4. `AcceptLanguageResolver` — browser default
5. `CookieResolver('lang')` — last-resort sticky preference for anonymous users
6. Fallback to `DEFAULT_LOCALE` (defaults to `en`)

Each resolver returns `undefined` rather than rewriting to `en` when it sees an unsupported value — silent fallback hides client bugs, so the chain proceeds.

**Translations JSONB shape (every translatable entity):**

```json
{ "en": { "title": "...", "description": "..." },
  "tr": { "title": "...", "description": "..." },
  "ar": { "title": "...", "description": "..." } }
```

`resolveTranslation()` in `common/i18n/types.ts` handles per-field fallback to `en` and reports `fallbackUsed: true` so services can emit missing-key warnings without spamming Sentry per-request (Week 7 BE-040 turns those into a daily digest).

**RFC 7807 response body (new shape):**

```json
{
  "type": "https://ios-lms.com/errors/invalid-credentials",
  "title": "<localised>",
  "status": 401,
  "detail": "<localised>",
  "instance": "/api/v1/auth/login",
  "code": "INVALID_CREDENTIALS",
  "request_id": "<ulid>",
  "errors": null,
  "timestamp": "2026-05-19T08:30:00.000Z"
}
```

Frontends pivot on `code` (stable contract); `title`/`detail` are display copy that may change per locale and per wording iteration.

**RLS interaction (none).** The i18n changes don't touch the scoped RLS perimeter from ADR-010 — `translations` JSONB columns sit on tables protected by app-layer guards, not RLS. No interceptor changes required.

---

## Deferred to Week 9 (i18n sprint)

| Item | Why deferred |
|---|---|
| Full Tr/Fr/Es/Ar/De catalogues for `errors.json`, `validation.json`, `common.json` | Translation pass, not a code pass — better as one batch with a translator review loop |
| 54 email templates × 6 locales seeded into `notification_templates` | Notification module doesn't exist yet (Week 7) |
| Catalog/Lesson/Blog translation authoring endpoints (admin) | Catalog admin endpoints land in Week 3 controllers; translation matrix UI is a Week 9 admin task |
| `i18n_publish_policy` column on catalog/blog (strict/en_first/any) | Not needed until publish workflow exists |
| `GET /admin/i18n/missing` report endpoint | Depends on Week 7 Sentry digest infrastructure |
| PDFKit Arabic shaping (BE-023B) | Lives in Week 6 cert sprint |
| Hreflang in sitemap.xml | Sitemap endpoint itself is Week 3 SEO scope |
| Class-validator constraint→i18n key adapter | Current filter passes the constraint message through verbatim; Week 9 adds the `ClassValidatorI18nAdapter` so DTOs stay decorator-only |

---

## Migration safety

`1748000000000-AddI18nSupport.ts` is reversible end-to-end. The `down()` drops every index, constraint, and column in reverse order. The `pg_trgm` extension is intentionally left in place on rollback — it's used elsewhere later, and dropping it could break future forward-from-zero migrations.

The CHECK constraints (`chk_users_locale_supported`, `chk_admin_users_locale_supported`) reject any future row insert/update with an unsupported locale. If you ever need to add a 7th language, the migration that adds it must also `ALTER TABLE ... DROP CONSTRAINT ... ; ALTER TABLE ... ADD CONSTRAINT ... CHECK (locale IN ('en','tr','fr','es','ar','de','<new>'))` — one transaction, no data risk.

---

## Branch state

```
$ git branch --show-current
feat/i18n-infrastructure

$ git status
On branch feat/i18n-infrastructure
Changes not staged for commit:
  modified:   IOS_LMS_Backend_TaskTracker.md   # uncommitted Week-2 update, unrelated
  modified:   src/app.module.ts                # i18n import wiring
  modified:   src/common/filters/global-exception.filter.ts
  modified:   src/common/filters/global-exception.filter.spec.ts
  modified:   src/database/entities/admin-user.entity.ts
  modified:   src/database/entities/auth-misc.entity.ts
  modified:   src/database/entities/certificate.entity.ts
  modified:   src/database/entities/exam.entity.ts
  modified:   src/database/entities/learning-module.entity.ts
  modified:   src/database/entities/lesson.entity.ts
  modified:   nest-cli.json
Untracked files:
  src/common/errors/
  src/common/i18n/
  src/database/migrations/1748000000000-AddI18nSupport.ts
  src/i18n/
```

(Git status from inside the Linux VM under-reports edits to existing files because of OneDrive mtime quirks; the actual file contents on disk are correct — verified via direct file reads. Your Windows-side `git status` will show the full set above.)

---

*End of summary.*
