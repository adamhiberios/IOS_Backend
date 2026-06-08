import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
    bufferLogs: false,
  });

  // -- Security headers --
  app.use(helmet());

  // -- Trust proxy --
  // Production runs behind a single trusted load balancer / reverse proxy
  // (DO App Platform LB, nginx, etc.). With `trust proxy` set, Express
  // populates `req.ip` from X-Forwarded-For with hop-count validation and
  // the throttler keys off the real client IP rather than the proxy's.
  // Without this set, a direct client can spoof X-Forwarded-For and bypass
  // any IP-based rate limit or audit attribution.
  //
  // Set to 1 = trust the single proxy directly in front of us. If you stack
  // more proxies (Cloudflare -> LB -> API), raise this to the hop count or
  // pass a specific subnet. In development (no proxy) this is a harmless
  // no-op because X-Forwarded-For won't be present.
  const httpAdapter = app.getHttpAdapter().getInstance();
  if (typeof httpAdapter?.set === 'function') {
    httpAdapter.set('trust proxy', 1);
  }

  // -- Cookie parsing - required for the refresh-token cookie --
  app.use(cookieParser());

  // -- API prefix --
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  // -- CORS --
  app.enableCors({
    origin: process.env.APP_BASE_URL ?? 'http://localhost:4000',
    credentials: true,
  });

  // -- Swagger --
  // Enabled when NODE_ENV != production OR when ENABLE_SWAGGER=true. The
  // explicit flag lets the dev environment (which runs with NODE_ENV=production
  // to keep all safety validations active) still expose /api/docs without
  // accidentally turning it on in real production.
  const swaggerEnabled =
    process.env.NODE_ENV !== 'production' ||
    process.env.ENABLE_SWAGGER === 'true';
  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('IOS LMS API')
      .setDescription('Institute of Scrum LMS Backend API - v1')
      .setVersion('1.0')
      .addBearerAuth({
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        in: 'header',
      })
      .addCookieAuth('refreshToken', {
        type: 'apiKey',
        in: 'cookie',
        name: 'refreshToken',
      })
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  console.log(
    `IOS LMS API listening on :${port} [${process.env.NODE_ENV ?? 'development'}]`,
  );
  if (swaggerEnabled) {
    console.log(`Swagger docs: http://localhost:${port}/api/docs`);
  }
}

void bootstrap();
