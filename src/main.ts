import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.use(helmet());
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/full'] });
  app.enableCors({
    origin: process.env.APP_BASE_URL ?? 'http://localhost:4000',
    credentials: true,
  });

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('IOS LMS API')
      .setDescription('Institute of Scrum LMS Backend API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`IOS LMS API running on :${port} [${process.env.NODE_ENV}]`);
}
bootstrap();
