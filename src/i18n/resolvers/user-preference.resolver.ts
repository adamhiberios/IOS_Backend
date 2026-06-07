import { ExecutionContext, Injectable } from '@nestjs/common';
import { I18nResolver } from 'nestjs-i18n';
import { isLocale } from '../../common/i18n/types';

/**
 * Default locale resolver for authenticated users — pulls the `locale` claim
 * out of the JWT carried by the request. An Arabic-preferring student gets
 * Arabic responses even from a German-locale browser, UNLESS the caller has
 * sent an explicit `X-Lang` header (locale switcher, admin preview, etc.) —
 * in which case the header wins. Falls through (returns `undefined`) for
 * anonymous requests, malformed tokens, or unsupported locale values.
 *
 * Why we parse the JWT directly here instead of reading `req.user.locale`:
 * `nestjs-i18n` resolves the locale early in the request pipeline — before
 * `JwtAuthGuard` has run and attached `req.user`. Relying on `req.user`
 * would silently miss the user's preference on every authenticated request.
 *
 * Security note: we deliberately do NOT verify the JWT signature here. Auth
 * is `JwtAuthGuard`'s job. The claim we read is only a hint about which
 * locale to render the response in — a tampered claim at worst gives the
 * caller a response in a different language, which is harmless because the
 * actual authorization decision still requires a properly-signed token.
 *
 * Ranked #3 in `AppI18nModule.resolvers`. The full chain (highest priority
 * first): `HeaderResolver('x-lang')` → `QueryResolver('lang')` → this →
 * `AcceptLanguageResolver` → `CookieResolver('lang')` → fallback
 * `DEFAULT_LOCALE`.
 */
@Injectable()
export class UserPreferenceResolver implements I18nResolver {
  resolve(context: ExecutionContext): string | undefined {
    if (context.getType() !== 'http') return undefined;

    const req = context.switchToHttp().getRequest<{
      user?: { locale?: string };
      headers?: Record<string, string | string[] | undefined>;
    }>();

    // Fast path — if guards have already run (later in some setups), the
    // attached user object carries `locale` directly.
    const fromUser = req?.user?.locale;
    if (fromUser && isLocale(fromUser)) return fromUser;

    // Slow path — resolve early, before guards run. Peek at the JWT claim
    // from the Authorization header. No signature verification; see header.
    const auth = req?.headers?.authorization;
    const bearer = Array.isArray(auth) ? auth[0] : auth;
    if (typeof bearer !== 'string' || !bearer.startsWith('Bearer ')) {
      return undefined;
    }
    const token = bearer.slice(7);
    const parts = token.split('.');
    if (parts.length !== 3) return undefined;

    try {
      const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
      const payload = JSON.parse(payloadJson) as { locale?: unknown };
      if (typeof payload.locale === 'string' && isLocale(payload.locale)) {
        return payload.locale;
      }
    } catch {
      // Malformed token — let the next resolver have a turn. Auth proper
      // will surface the bad token via JwtAuthGuard with a clean 401.
    }
    return undefined;
  }
}
