import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TournamentsModule } from './tournaments/tournaments.module';
import { PrismaService } from 'prisma/prisma.service';

@Module({
  imports: [TournamentsModule],
  controllers: [AppController],
  providers: [AppService] // Export PrismaService for use in other modules
})
export class AppModule {}
