import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { IoAdapter } from '@nestjs/platform-socket.io';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: [
      'http://localhost:4200',
      'https://poker-tournament.pointvirgule.dev'
    ],
    credentials: true,
  });

  // **Ajoute ceci**
  app.useWebSocketAdapter(new IoAdapter(app));

  await app.listen(3000, '0.0.0.0');
}
bootstrap();
