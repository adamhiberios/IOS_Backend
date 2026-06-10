# IOS LMS — Email templates

Brand-aligned HTML + plain-text email templates for every notification the system sends. Templates use simple `{{token}}` placeholders that any renderer (Handlebars, a regex replacer, NestJS i18n interpolation) can fill.

## Design tokens used across every template

Pulled from the IOS LMS style guide:

| Token | Value | Use |
|-------|-------|-----|
| Brand red | `#7A1A1A` | Header background, primary buttons, accent rules |
| Brand red (hover) | `#5C1314` | Button hover (where supported) |
| Dark | `#1F1F1F` | Footer background, body text |
| Muted | `#6B7280` | Secondary text, meta info |
| Background | `#F5F5F4` | Outer email canvas |
| Surface | `#FFFFFF` | Content card background |
| Border | `#E5E5E5` | Hairlines, dividers |
| Yellow accent | `#F0C419` | Warning / highlight blocks (used sparingly) |
| Success | `#3F7D3F` | Success status indicators |
| Danger | `#B33A3A` | Failure / alert indicators |

**Typography** (web-safe so it renders across Gmail / Outlook / Apple Mail):

- Display / headings: `Georgia, 'Times New Roman', serif` — matches the serif feel of the style guide
- Body / UI: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`
- Logo wordmark: rendered in inline HTML (no image) so it survives image-blocking in Outlook / corporate clients

## Layout

All templates share the same outer chrome:

```
┌──────────────────────────────────────────┐
│  [brand red header]                      │
│  INSTITUTE                               │
│  OF SCRUM                                │
│                                          │
├──────────────────────────────────────────┤
│  [white content card]                    │
│  H1: Action title                        │
│  Body copy                               │
│  Primary CTA button                      │
│  Secondary actions / fallback link       │
│                                          │
├──────────────────────────────────────────┤
│  [dark footer]                           │
│  Help / unsubscribe / address            │
└──────────────────────────────────────────┘
```

Max width 600px. Mobile-responsive via fluid widths + media queries. Table-based layout for Outlook compatibility. All CSS inlined (no `<style>` blocks survive most clients).

## Templates

| File | Trigger | Required tokens |
|------|---------|-----------------|
| `email-verification.html/.txt` | After student registration | `firstName`, `verificationUrl`, `expiresInHours` |
| `password-reset.html/.txt` | `POST /auth/forgot-password` | `firstName`, `resetUrl`, `expiresInHours` |
| `password-changed.html/.txt` | `PATCH /me/password` succeeds | `firstName`, `changedAt`, `ipAddress`, `supportEmail` |
| `welcome.html/.txt` | After email verified | `firstName`, `appUrl`, `catalogUrl` |
| `purchase-confirmation.html/.txt` | Stripe checkout succeeds | `firstName`, `certTitle`, `amount`, `currency`, `transactionId`, `dashboardUrl` |
| `enrollment-confirmation.html/.txt` | Enrolled in a cert | `firstName`, `certTitle`, `instructor`, `startUrl` |
| `exam-access-code.html/.txt` | Admin assigns exam | `firstName`, `examTitle`, `accessCode`, `validUntil`, `examUrl` |
| `exam-result.html/.txt` | Exam submitted (conditional pass/fail) | `firstName`, `examTitle`, `score`, `passingScore`, `passed`, `certificateUrl`, `retryUrl` |
| `certificate-issued.html/.txt` | Certificate generated | `firstName`, `certTitle`, `serialNumber`, `issuedAt`, `certificateUrl`, `verifyUrl` |
| `admin-account-created.html/.txt` | Super admin invites staff | `firstName`, `role`, `tempPassword`, `loginUrl`, `mustChangePassword` |
| `security-login-alert.html/.txt` | New device login (optional) | `firstName`, `ipAddress`, `location`, `userAgent`, `loginAt`, `supportEmail` |

## Token rendering

The templates use `{{token}}` syntax. To render with a simple regex replacer:

```ts
function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}
```

Or wire up [Handlebars](https://handlebarsjs.com/) if you need conditionals (`{{#if passed}}...{{/if}}`) and loops. The `exam-result.html` template uses one `{{#if passed}}` block — switch to Handlebars or extract two templates if you don't want a template engine.

**Recommended integration in `MailService`:**

```ts
import { readFileSync } from 'fs';
import { join } from 'path';

private renderTemplate(name: string, vars: Record<string, string>): { html: string; text: string } {
  const dir = join(__dirname, 'templates');
  const html = readFileSync(join(dir, `${name}.html`), 'utf8');
  const text = readFileSync(join(dir, `${name}.txt`), 'utf8');
  return {
    html: render(html, vars),
    text: render(text, vars),
  };
}
```

Add `nest-cli.json` to include `*.html` and `*.txt` as compile assets so they ship in `dist/`:

```json
"assets": [
  { "include": "modules/mail/templates/**/*", "outDir": "dist" }
]
```

## Plain-text versions

Every HTML template has a matching `.txt` file. SendGrid (and good email practice) requires both — clients that don't render HTML use the text version, and including it improves deliverability / spam scores.

## Localization

Templates are English-only for now. To localize:

1. Move the `{{token}}` content into the existing nestjs-i18n resources (`src/i18n/resources/<locale>.json`).
2. In `MailService`, pull the locale-specific strings via `i18n.translate(...)` and pass them as tokens to the template renderer.

The HTML chrome (header, footer, structure) stays in one file per template; only the copy varies by locale.

## Preview / development

To preview a template visually:

1. Open the `.html` file directly in a browser — the inlined styles render correctly.
2. Substitute the `{{token}}` placeholders manually or with a tiny script:

   ```powershell
   (Get-Content .\email-verification.html) -replace '\{\{firstName\}\}','Jane' -replace '\{\{verificationUrl\}\}','https://example.com/verify' | Out-File preview.html
   start preview.html
   ```

3. For final cross-client verification before any production use, run the template through [Litmus](https://www.litmus.com/) or [Email on Acid](https://www.emailonacid.com/) — free trials are sufficient for an initial pass.
