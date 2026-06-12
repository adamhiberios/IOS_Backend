# IOS LMS — Demo Data

A rich, internally-consistent demo dataset for development, demos, and frontend work.
Linked script: [`src/database/seeds/demo-seed.ts`](../src/database/seeds/demo-seed.ts)

## Run it

```bash
# inside docker (recommended — uses the container's DB env)
npm run docker:seed:demo

# or locally against your .env database
npm run seed:demo
```

Safe to re-run at any time: every demo row uses a deterministic UUID in the
`dd……-0000-4000-a000-*` namespace, and the script first deletes **only that
slice** (children cascade), then re-inserts it clean. Anything you created
manually is never touched. The script refuses to run with `NODE_ENV=production`.

All inserts into the FORCE-RLS tables (`student_purchases`, `exam_attempts`,
`transactions`, `issued_certificates`) run inside `set_config('app.current_user_id', …)`
transactions — the project's RLS-aware seed pattern — so it also works under a
non-superuser DB role.

## Accounts

**Shared password for every demo account: `Demo@123!`**

### Admin users

| Email | Role |
|---|---|
| `demo-learning@ios.local` | learning_admin |
| `demo-content@ios.local` | content_creator |
| `demo-finance@ios.local` | finance_admin |
| `demo-support@ios.local` | support_admin |

(The super_admin comes from the existing bootstrap seeder, not this script.)

### Students — one per lifecycle stage

| Email | Storyline |
|---|---|
| `demo+sara@ios.local` | Bought PSM 30d ago, completed all 12 lessons, **passed** Assessment 1 with 90%, has an issued certificate |
| `demo+omar@ios.local` | Bought PSM, 8/12 lessons, **failed** Assessment 1 with 60%, holds an unused one-time access code for Assessment 2 (locale `ar`) |
| `demo+lina@ios.local` | Bought PSPO, mid-course (5/9 lessons), no exam attempt yet (locale `tr`) |
| `demo+yusuf@ios.local` | Bought PSD **with promo SCRUM20** (paid $103.20), 1 lesson in |
| `demo+mona@ios.local` | PAL **passed with 100%** + certified; also bought PSM 2d ago, untouched |
| `demo+karim@ios.local` | Verified account, browsing only — no purchases |
| `demo+aisha@ios.local` | Registered but **email NOT verified** (tests the verify flow) |
| `demo+tom@ios.local` | Deactivated account (`active=false`) (tests the suspended path) |

**Omar's plain access code** (PSM Assessment 2, 24h validity, re-issued on every seed run):

```
abababababababababababababababababababababababababababababababab
```

## Catalog

6 certificates with `en`/`tr`/`ar` translations, modules, lessons, and weighted exams:

| Program | Title | Level | Price | Modules × Lessons | Exams |
|---|---|---|---|---|---|
| PSM | Professional Scrum Master I | foundation | $149 | 3 × 4 | 3 published |
| PSPO | Professional Scrum Product Owner I | foundation | $149 | 3 × 3 | 2 published |
| PSD | Professional Scrum Developer I | foundation | $129 | 2 × 3 | 2 published |
| PAL | Professional Agile Leadership | practitioner | $199 | 2 × 3 | 1 published |
| SPS | Scaled Professional Scrum | practitioner | $249 | 2 × 2 | 1 published |
| PMP | Project Management Professional Bridge | authority | $299 | 2 × 2 | 1 published + **1 DRAFT** |

Every exam has 5 questions (3 MCQ + 2 true/false) with marks `3,2,2,2,1`
(total 10), so attempt scores land on clean percentages under the
marks-weighted scoring. Passing score 80%, duration 60 min. The PMP draft
exam exists to exercise the M9 PUBLISHED guard in admin tooling.

## Promo codes

| Code | Type | Scope | Notes |
|---|---|---|---|
| `SCRUM20` | 20% percentage | all certificates | usage_count already 1 (Yusuf), expires +90d |
| `LAUNCH100` | full_waiver | PSD only | max 5 uses, expires +30d |
| `EXPIRED10` | 10% percentage | all | already expired — tests rejection paths |

## What this exercises

Catalog browsing/search/i18n fallback, curriculum + purchase gate (RLS),
lesson progress idempotency, exam assignment algorithm (Omar's next-exam
state), validate-access/start with a real outstanding code, pass/fail/retake
flows, issued-certificate verification (Week 6), promo engine inputs
(Week 5), unverified/deactivated account handling, and per-role admin portal
permissions.
