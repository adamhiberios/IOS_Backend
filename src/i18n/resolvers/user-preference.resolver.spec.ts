import { ExecutionContext } from '@nestjs/common';
import { UserPreferenceResolver } from './user-preference.resolver';

interface ContextOpts {
  user?: unknown;
  authHeader?: string;
  type?: 'http' | 'ws' | 'rpc';
}

function buildContext({
  user,
  authHeader,
  type = 'http',
}: ContextOpts): ExecutionContext {
  return {
    getType: () => type,
    switchToHttp: () => ({
      getRequest: () => ({
        user,
        headers: authHeader ? { authorization: authHeader } : {},
      }),
    }),
  } as unknown as ExecutionContext;
}

/**
 * Build a JWT-like string with the given payload (signature is bogus —
 * the resolver does NOT verify, it only base64-decodes the payload).
 */
function makeJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature-not-checked-here`;
}

describe('UserPreferenceResolver', () => {
  let resolver: UserPreferenceResolver;

  beforeEach(() => {
    resolver = new UserPreferenceResolver();
  });

  describe('via req.user (post-guard timing)', () => {
    it('returns the user locale when it is in the supported set', () => {
      expect(resolver.resolve(buildContext({ user: { locale: 'tr' } }))).toBe('tr');
      expect(resolver.resolve(buildContext({ user: { locale: 'ar' } }))).toBe('ar');
      expect(resolver.resolve(buildContext({ user: { locale: 'en' } }))).toBe('en');
    });

    it('returns undefined when the user locale is unsupported — never silently rewrite', () => {
      expect(resolver.resolve(buildContext({ user: { locale: 'ja' } }))).toBeUndefined();
      expect(resolver.resolve(buildContext({ user: { locale: 'EN' } }))).toBeUndefined();
      expect(resolver.resolve(buildContext({ user: { locale: '' } }))).toBeUndefined();
    });
  });

  describe('via JWT in Authorization header (pre-guard timing)', () => {
    it('reads the locale claim from a Bearer token', () => {
      const jwt = makeJwt({ sub: 'abc', type: 'student', locale: 'tr' });
      expect(
        resolver.resolve(buildContext({ authHeader: `Bearer ${jwt}` })),
      ).toBe('tr');
    });

    it('falls through when the JWT carries no locale claim', () => {
      const jwt = makeJwt({ sub: 'abc', type: 'student' });
      expect(
        resolver.resolve(buildContext({ authHeader: `Bearer ${jwt}` })),
      ).toBeUndefined();
    });

    it('falls through when the JWT carries an unsupported locale', () => {
      const jwt = makeJwt({ sub: 'abc', locale: 'ja' });
      expect(
        resolver.resolve(buildContext({ authHeader: `Bearer ${jwt}` })),
      ).toBeUndefined();
    });

    it('falls through on a malformed token', () => {
      expect(
        resolver.resolve(buildContext({ authHeader: 'Bearer not-a-jwt' })),
      ).toBeUndefined();
      expect(
        resolver.resolve(buildContext({ authHeader: 'Bearer a.b' })),
      ).toBeUndefined();
      expect(
        resolver.resolve(buildContext({ authHeader: 'NotBearer token' })),
      ).toBeUndefined();
    });

    it('prefers req.user when both paths are available', () => {
      const jwt = makeJwt({ locale: 'ar' });
      expect(
        resolver.resolve(
          buildContext({ user: { locale: 'tr' }, authHeader: `Bearer ${jwt}` }),
        ),
      ).toBe('tr');
    });
  });

  describe('anonymous / non-http', () => {
    it('returns undefined for fully anonymous requests', () => {
      expect(resolver.resolve(buildContext({}))).toBeUndefined();
      expect(resolver.resolve(buildContext({ user: {} }))).toBeUndefined();
    });

    it('returns undefined on non-HTTP transports', () => {
      expect(
        resolver.resolve(buildContext({ user: { locale: 'tr' }, type: 'ws' })),
      ).toBeUndefined();
    });
  });
});
