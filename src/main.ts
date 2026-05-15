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

  // ── Security headers ────────────────────────────────────────────────────
  app.use(helmet());

  // ── Cookie parsing — required for the refresh-token cookie ──────────────
  app.use(cookieParser());

  // ── API prefix ─────────────────────────────────────────────────────────
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  // ── CORS ───────────────────────────────────────────────────────────────
  app.enableCors({
    origin: process.env.APP_BASE_URL ?? 'http://localhost:4000',
    credentials: true,
  });

  // ── Swagger (staging + dev only) ───────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('IOS LMS API')
      .setDescription('Institute of Scrum LMS Backend API — v1')
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
  if (process.env.NODE_ENV !== 'production') {
    console.log(`Swagger docs: http://localhost:${port}/api/docs`);
  }
}

void bootstrap();
