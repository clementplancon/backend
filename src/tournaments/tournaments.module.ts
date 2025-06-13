import { Module } from '@nestjs/common';
import { TournamentsService } from './tournaments.service';
import { TournamentsController } from './tournaments.controller';
import { PrismaService } from 'prisma/prisma.service';
import { TournamentsGateway } from './tournaments.gateway';
import { ClockSchedulerService } from './clock-scheduler.service';

@Module({
  providers: [TournamentsService, PrismaService, TournamentsGateway, ClockSchedulerService],
  controllers: [TournamentsController],
  exports: [TournamentsGateway],
})
export class TournamentsModule {}
