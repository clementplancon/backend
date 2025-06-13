import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { TournamentsGateway } from './tournaments.gateway';
import { PrismaService } from 'prisma/prisma.service';

@Injectable()
export class ClockSchedulerService implements OnModuleInit {
  constructor(private prisma: PrismaService, private gateway: TournamentsGateway) {}

  onModuleInit() {
    setInterval(() => this.tick(), 5000); // Toutes les 5 secondes
  }

  async tick() {
    // Récupère tous les clocks actives
    const clocks = await this.prisma.clock.findMany({
      where: { paused: false, tournament: { etat: 'en_cours' } },
      include: { tournament: true }
    });

    for (const clock of clocks) {
      // Récupère le niveau courant
      const blindes = await this.prisma.blindLevel.findMany({
        where: { tournamentId: clock.tournamentId },
        orderBy: { niveau: 'asc' }
      });
      const current = blindes[clock.currentLevel];
      if (!current) continue;

      // Calcul temps écoulé
      const now = new Date();
      const seconds = clock.elapsed + Math.floor((now.getTime() - new Date(clock.levelStartAt).getTime()) / 1000);

      if (seconds >= current.duree) {
        // Passe au niveau suivant
        await this.prisma.clock.update({
          where: { id: clock.id },
          data: {
            currentLevel: { increment: 1 },
            levelStartAt: now,
            elapsed: 0,
            paused: false,
          }
        });
        this.gateway.emitTournamentState(clock.tournament.code, await this.tournamentState(clock.tournament.code));
      }
    }
  }

  async tournamentState(code: string) {
    return this.prisma.tournament.findUnique({
      where: { code },
      include: {
        blind_levels: { orderBy: { niveau: 'asc' } },
        players: true,
        tables: { include: { players: true } },
        clock: true
      }
    });
  }
}
