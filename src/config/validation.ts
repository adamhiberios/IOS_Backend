import * as Joi from 'joi';

// Well-known dev-default secrets that ship in docker-compose.yml /
// .env.example as `:-` fallbacks. If any of these reach the app in
// production, refuse to boot — this is the safety net for production
// deploys where these fallbacks must never apply.
const KNOWN_DEV_JWT_SECRETS = [
  'development-only-jwt-access-secret-min-64-chars-replace-in-production',
  'development-only-jwt-refresh-secret-different-from-access-secret-here',
  'change-me-min-64-chars-random-string-generated-securely-for-production',
  'change-me-separate-refresh-secret-min-64-chars-random-string',
];

// Mock external-service keys that ship as `:-` defaults. Useful in dev,
// lethal in prod.
const KNOWN_MOCK_KEYS = ['sk_test_mock', 'whsec_mock', 'SG.mock'];

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'staging', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  WS_PORT: Joi.number().default(3001),
  APP_BASE_URL: Joi.string().uri().required(),
  DATABASE_URL: Joi.string().required(),
  REDIS_URL: Joi.string().required(),
  JWT_SECRET: Joi.string()
    .min(32)
    .required()
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string()
        .invalid(...KNOWN_DEV_JWT_SECRETS)
        .messages({
          'any.invalid':
            'JWT_SECRET is set to a well-known dev default. Generate a fresh random secret before deploying to production.',
        }),
    }),
  JWT_REFRESH_SECRET: Joi.string()
    .min(32)
    .required()
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string()
        .invalid(...KNOWN_DEV_JWT_SECRETS)
        .messages({
          'any.invalid':
            'JWT_REFRESH_SECRET is set to a well-known dev default. Generate a fresh random secret before deploying to production.',
        }),
    }),
  JWT_ACCESS_TTL: Joi.number().default(900),
  JWT_REFRESH_TTL: Joi.number().default(604800),
  STRIPE_SECRET_KEY: Joi.string()
    .required()
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string().invalid(...KNOWN_MOCK_KEYS),
    }),
  STRIPE_WEBHOOK_SECRET: Joi.string()
    .required()
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string().invalid(...KNOWN_MOCK_KEYS),
    }),
  SENDGRID_API_KEY: Joi.string()
    .required()
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string().invalid(...KNOWN_MOCK_KEYS),
    }),

  // ── Storage (S3-compatible: MinIO in dev, DO Spaces in prod) ──────────
  DO_SPACES_ENDPOINT: Joi.string().uri().required(),
  // What we return to clients. In prod, equal to DO_SPACES_ENDPOINT. In dev
  // with MinIO, differs (browser-reachable vs docker-network-reachable).
  DO_SPACES_PUBLIC_URL: Joi.string().uri().required(),
  DO_SPACES_REGION: Joi.string().default('us-east-1'),
  DO_SPACES_KEY: Joi.string().required(),
  DO_SPACES_SECRET: Joi.string().required(),
  // Three explicit buckets per the SoT §6.5 + architecture study §2.6. The
  // older single DO_SPACES_BUCKET variable is intentionally removed — every
  // bucket has different access semantics (public-read vs auth vs signed)
  // so collapsing them into one was misleading.
  DO_SPACES_BUCKET_CERTIFICATES: Joi.string().required(),
  DO_SPACES_BUCKET_MEDIA: Joi.string().required(),
  DO_SPACES_BUCKET_VIDEOS: Joi.string().required(),

  DEFAULT_LOCALE: Joi.string().default('en'),
  SUPPORTED_LOCALES: Joi.string().default('en,tr,fr,es,ar,de'),

  // ── super_admin bootstrap (handled by SeederService) ───────────────────
  // All optional at the schema level — env-specific enforcement happens in
  // SeederService.resolveCredentials() because the requirements differ per
  // NODE_ENV (dev allows fallback to defaults; staging+prod require explicit
  // values; prod additionally requires the BOOTSTRAP_SUPER_ADMIN=true flag).
  BOOTSTRAP_SUPER_ADMIN: Joi.string().valid('true', 'false').optional(),
  BOOTSTRAP_SUPER_ADMIN_EMAIL: Joi.string().email().optional(),
  BOOTSTRAP_SUPER_ADMIN_PASSWORD: Joi.string().min(12).optional(),
  BOOTSTRAP_SUPER_ADMIN_FIRST_NAME: Joi.string().optional(),
  BOOTSTRAP_SUPER_ADMIN_LAST_NAME: Joi.string().optional(),

  // ── Throttler override (test only) ──────────────────────────────────────
  TEST_THROTTLE_AUTH_LIMIT: Joi.number().optional(),
});
