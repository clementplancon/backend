import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Active CORS pour le front (localhost:4200)
  app.enableCors({
    origin: ['http://localhost:4200'],
    credentials: true, // si tu veux utiliser des cookies ou Authorization
  });

  await app.listen(3000);
}
bootstrap();
