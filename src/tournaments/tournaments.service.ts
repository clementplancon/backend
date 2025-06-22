import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { randomBytes } from 'crypto';
import { PrismaService } from 'prisma/prisma.service';
import { UpdateTournamentDto } from './dto/update-tournament.dto';
import { EliminatePlayerDto } from './dto/eliminated-player.dto';
import { SeatChangeDto } from './dto/seat-change.dto';
import { Player, Tournament } from '@prisma/client';
import { TournamentsGateway } from './tournaments.gateway';

@Injectable()
export class TournamentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: TournamentsGateway,
  ) {}

  // --- Utilitaires ---
  private generateRoomCode(): string {
    return randomBytes(4).toString('hex').toUpperCase();
  }
  private generateAdminToken(): string {
    return randomBytes(32).toString('hex');
  }
  private async findWithToken(code: string, token: string) {
    const t = await this.prisma.tournament.findUnique({ where: { code } });
    if (!t) throw new NotFoundException('Tournoi introuvable');
    const admin = await this.prisma.adminSession.findFirst({ where: { tournamentId: t.id, token } });
    if (!admin) throw new UnauthorizedException('Token admin invalide');
    return t;
  }
  private canRecave(player: Player, tournament: Tournament, currentLevel?: number) {
    if (tournament.recave_max && player.recaves >= tournament.recave_max) return false;
    if (tournament.niveau_recave_max && currentLevel && currentLevel > tournament.niveau_recave_max) return false;
    return true;
  }
  private async getFreeSeat(tableId: number): Promise<number | null> {
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
      include: { players: true, tournament: true }
    });
    if (!table) throw new NotFoundException('Table introuvable');
    const occupiedSeats = new Set(table.players.map(p => p.siege));
    for (let i = 1; i <= table.tournament.joueurs_par_table; i++) {
      if (!occupiedSeats.has(i)) return i;
    }
    throw new Error('Aucun siège libre trouvé');
  }

  // --- Création et update du tournoi ---
  async createTournament(dto: CreateTournamentDto) {
    const code = this.generateRoomCode();
    const adminToken = this.generateAdminToken();

    const tournament = await this.prisma.tournament.create({
      data: {
        code,
        nom: dto.nom,
        etat: 'config',
        stack_initial: dto.stack_initial,
        valeur_cave: dto.valeur_cave,
        nb_tables: dto.nb_tables,
        joueurs_par_table: dto.joueurs_par_table,
        recave_max: dto.recave_max,
        niveau_recave_max: dto.niveau_recave_max,
        jetons: dto.jetons,
      },
    });

    await this.prisma.adminSession.create({
      data: { tournamentId: tournament.id, token: adminToken },
    });

    for (const blinde of dto.blindes) {
      await this.prisma.blindLevel.create({
        data: {
          tournamentId: tournament.id,
          niveau: blinde.niveau,
          sb: blinde.sb,
          bb: blinde.bb,
          ante: blinde.ante,
          duree: blinde.duree,
          is_pause: blinde.is_pause || false,
        },
      });
    }

    // Ajout des tables
    for (let i = 1; i <= dto.nb_tables; i++) {
      await this.prisma.table.create({
        data: {
          tournamentId: tournament.id,
          numero: i,
        },
      });
    }

    // On broadcast la nouvelle room si besoin (optionnel)
    return { code, adminToken };
  }

  async updateTournament(code: string, token: string, updates: UpdateTournamentDto) {
    const tournament = await this.findWithToken(code, token);

    const updated = await this.prisma.tournament.update({
      where: { id: tournament.id },
      data: {
        ...updates,
        updated_at: new Date(),
      },
    });

    this.gateway.emitTournamentState(code, await this.getTournamentStatePayload(code));
    return updated;
  }

  async removePlayer(code: string, token: string, playerId: number) {
    const t = await this.findWithToken(code, token);
    if (t.etat !== 'config') {
      throw new Error('Suppression impossible : le tournoi a déjà démarré.');
    }
  
    const player = await this.prisma.player.findUnique({ where: { id: playerId } });
    if (!player || player.tournamentId !== t.id) throw new NotFoundException('Joueur introuvable');
  
    await this.prisma.player.delete({ where: { id: playerId } });
  
    // Broadcast nouvelle state
    this.gateway.emitTournamentState(code, await this.getTournamentStatePayload(code));
  
    return { removed: true };
  }

  async getTournamentForAdmin(code: string, token: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { code },
      include: {
        blind_levels: true,
        players: {include: { table: true }},
        tables: {include: { players: true }},
        clock: true,
      },
    });
    if (!tournament) throw new NotFoundException('Tournoi introuvable');
    const adminSession = await this.prisma.adminSession.findFirst({
      where: { tournamentId: tournament.id, token },
    });
    if (!adminSession) throw new UnauthorizedException('Token admin invalide.');
    return tournament;
  }

  // --- Contrôle du tournoi (start/pause/resume) ---
  async startTournament(code: string, token: string) {
    const t = await this.findWithToken(code, token);
    if (t.etat !== 'config') throw new Error('Déjà démarré');

    // 1. Crée la clock à l’index 0 (premier niveau)
    const now = new Date();
    await this.prisma.clock.create({
      data: {
        tournamentId: t.id,
        currentLevel: 0, // index dans la structure (0 = premier)
        levelStartAt: now,
        elapsed: 0,
        paused: false,
      },
    });

    await this.prisma.tournament.update({ where: { code }, data: { etat: 'en_cours' } });
    await this.prisma.tournamentState.create({ data: { tournamentId: t.id, etat: 'en_cours' } });
    this.gateway.emitTournamentState(code, await this.getTournamentStatePayload(code));
    return { ok: true };
  }

  async pauseTournament(code: string, token: string) {
    const t = await this.findWithToken(code, token);
    if (t.etat !== 'en_cours') throw new Error('Impossible de mettre en pause un tournoi non démarré');
    const clock = await this.prisma.clock.findUnique({ where: { tournamentId: t.id } });
    if (!clock) throw new Error('Clock not found');

    // Calcule le temps écoulé sur ce niveau (depuis levelStartAt)
    const now = new Date();
    const secondsElapsed = Math.floor((now.getTime() - new Date(clock.levelStartAt).getTime()) / 1000);
    const newElapsed = clock.elapsed + (clock.paused ? 0 : secondsElapsed);

    await this.prisma.clock.update({
      where: { tournamentId: t.id },
      data: { elapsed: newElapsed, paused: true }
    });

    await this.prisma.tournament.update({ where: { code }, data: { etat: 'pause' } });
    await this.prisma.tournamentState.create({ data: { tournamentId: t.id, etat: 'pause' } });
    this.gateway.emitTournamentState(code, await this.getTournamentStatePayload(code));
    return { ok: true };
  }

  async resumeTournament(code: string, token: string) {
    const t = await this.findWithToken(code, token);
    if (t.etat !== 'pause') throw new Error('Le tournoi n’est pas en pause');
    const clock = await this.prisma.clock.findUnique({ where: { tournamentId: t.id } });
    if (!clock) throw new Error('Clock not found');
    const now = new Date();

    // Redémarre sur le niveau actuel
    await this.prisma.clock.update({
      where: { tournamentId: t.id },
      data: { levelStartAt: now, paused: false }
    });
    await this.prisma.tournament.update({ where: { code }, data: { etat: 'en_cours' } });
    await this.prisma.tournamentState.create({ data: { tournamentId: t.id, etat: 'en_cours' } });
    this.gateway.emitTournamentState(code, await this.getTournamentStatePayload(code));
    return { ok: true };
  }

  // Passe au niveau suivant (automatique ou via admin)
  async nextLevel(code: string, token: string) {
    const t = await this.findWithToken(code, token);
    const clock = await this.prisma.clock.findUnique({ where: { tournamentId: t.id } });
    if (!clock) throw new Error('Clock not found');

    // On récupère le nombre de niveaux
    const blindes = await this.prisma.blindLevel.findMany({
      where: { tournamentId: t.id },
      orderBy: { niveau: 'asc' }
    });
    if (clock.currentLevel + 1 >= blindes.length) {
      // Tournoi terminé (plus de niveaux)
      await this.prisma.tournament.update({ where: { id: t.id }, data: { etat: 'finished' } });
      await this.prisma.clock.update({ where: { tournamentId: t.id }, data: { paused: true } });
      this.gateway.emitTournamentState(code, await this.getTournamentStatePayload(code));
      this.gateway.emitLeaderboardUpdated(code, await this.getLeaderboard(t.id));
      return { finished: true };
    }

    // Passe au niveau suivant
    await this.prisma.clock.update({
      where: { tournamentId: t.id },
      data: {
        currentLevel: { increment: 1 },
        levelStartAt: new Date(),
        elapsed: 0,
        paused: false
      }
    });

    this.gateway.emitTournamentState(code, await this.getTournamentStatePayload(code));
    this.gateway.emitBlindsUp(code, clock.currentLevel);
    return { ok: true };
  }

  // Reset clock en cas de besoin (par admin ? ou auto)
  async resetClock(code: string, token: string) {
    const t = await this.findWithToken(code, token);
    await this.prisma.clock.update({
      where: { tournamentId: t.id },
      data: { currentLevel: 0, levelStartAt: new Date(), elapsed: 0, paused: false }
    });
    this.gateway.emitTournamentState(code, await this.getTournamentStatePayload(code));
    return { ok: true };
  }

  // --- Gestion joueur : élimination/recave ---
  async eliminateOrRecavePlayer(code: string, token: string, dto: EliminatePlayerDto) {
    const t = await this.findWithToken(code, token);
    const player = await this.prisma.player.findUnique({ where: { id: dto.playerId } });
    if (!player || player.tournamentId !== t.id) throw new NotFoundException('Joueur introuvable');
    const clock = await this.prisma.clock.findUnique({ where: { tournamentId: t.id } });
    // Recave ?
    // À faire : déterminer le niveau courant du tournoi pour la limite recave
    if (dto.recave && this.canRecave(player, t, clock?.currentLevel)) {
      await this.prisma.player.update({
        where: { id: player.id },
        data: { recaves: { increment: 1 }, is_out: false },
      });
      this.gateway.emitPlayerRecaved(code, { playerId: player.id });
      this.gateway.emitTournamentState(code, await this.getTournamentStatePayload(code));
      return { recave: true };
    }

    // Sinon élimination
    await this.prisma.player.update({
      where: { id: player.id },
      data: { is_out: true, siege: null, tableId: null },
    });
    this.gateway.emitPlayerEliminated(code, { playerId: player.id });
    this.gateway.emitTournamentState(code, await this.getTournamentStatePayload(code));

    // Rééquilibrage à traiter
    await this.handleRebalancing(t);

    // Gestion de la fin de tournoi
    await this.checkIfFinished(t);

    return { eliminated: true };
  }

  // --- Changement de siège (rééquilibrage) ---
  async seatChange(code: string, token: string, dto: SeatChangeDto) {
    const t = await this.findWithToken(code, token);
    const table = await this.prisma.table.findUnique({
      where: { id: dto.toTableId }
    });
    if (!table || table.tournamentId !== t.id) throw new NotFoundException('Table introuvable');
    const seat = await this.getFreeSeat(dto.toTableId);
    const updatedPlayer = await this.prisma.player.update({
      where: { id: dto.playerId },
      data: { tableId: dto.toTableId, siege: seat }
    });
    this.gateway.server.to(code).emit('playerTableChange', { pseudo: updatedPlayer.pseudo, table: table.numero, siege: seat });
    this.gateway.emitTournamentState(code, await this.getTournamentStatePayload(code));
    return { ok: true };
  }

  async seatUnassignedPlayers(code: string, token: string) {
    // Authentification admin
    const t = await this.findWithToken(code, token);

    // Récupère toutes les tables et joueurs sans table ni siège
    const tables = await this.prisma.table.findMany({
      where: { tournamentId: t.id },
      include: { players: true, tournament: true }
    });

    let unassigned = await this.prisma.player.findMany({
      where: { tournamentId: t.id, tableId: null }
    });
    if (unassigned.length === 0) {
      // Rien à faire
      return { assigned: 0, message: 'Aucun joueur à assigner.' };
    }

    // Mélange les joueurs aléatoirement (Fisher-Yates)
    for (let i = unassigned.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [unassigned[i], unassigned[j]] = [unassigned[j], unassigned[i]];
    }

    // Index pour équilibrage : à chaque fois, place sur la table la moins remplie
    for (const player of unassigned) {
      // Recalcule le nombre de joueurs actifs par table
      const tablesSorted = tables
        .map(tbl => ({
          ...tbl,
          active: tbl.players.filter(p => p.siege != null).length
        }))
        .sort((a, b) => a.active - b.active);

      const table = tablesSorted[0]; // Table la moins pleine
      // Cherche un siège libre sur cette table
      const occupied = new Set(table.players.map(p => p.siege).filter(s => s != null));
      let possibleSeats: number[] = [];
      for (let i = 1; i <= t.joueurs_par_table; i++) {
        if (!occupied.has(i)) possibleSeats.push(i);
      }
      if (possibleSeats.length === 0) continue; // plus de place

      const seat = possibleSeats[Math.floor(Math.random() * possibleSeats.length)];

      // Met à jour le joueur
      await this.prisma.player.update({
        where: { id: player.id },
        data: { tableId: table.id, siege: seat }
      });
      // Mets à jour la table locale pour la suite du traitement
      table.players.push({ ...player, siege: seat });
    }

    // Broadcast nouvelle state
    this.gateway.emitTournamentState(code, await this.getTournamentStatePayload(code));
    return { assigned: unassigned.length };
  }

  async closeTableAndRedistribute(code: string, token: string, fromTableId: number, mapping: { playerId: number, toTableId: number }[]) {
    const t = await this.findWithToken(code, token);
  
    // Déplacer tous les joueurs de fromTableId vers leur nouvelle table, siège libre aléatoire
    for (const move of mapping) {
      // Cherche un siège libre sur la table cible
      const targetTable = await this.prisma.table.findUnique({
        where: { id: move.toTableId },
        include: { players: true, tournament: true }
      });
      if (!targetTable) throw new NotFoundException('Table cible introuvable');
      const occupied = new Set(targetTable.players.map(p => p.siege).filter(Boolean));
      let seat: number | null = null;
      for (let i = 1; i <= targetTable.tournament.joueurs_par_table; i++) {
        if (!occupied.has(i)) { seat = i; break; }
      }
      if (!seat) throw new Error('Aucun siège libre trouvé');
  
      await this.prisma.player.update({
        where: { id: move.playerId },
        data: { tableId: move.toTableId, siege: seat }
      });
    }
  
    // Ferme la table (set fermee=true), retire tous les joueurs (sécurité)
    await this.prisma.table.update({
      where: { id: fromTableId },
      data: { fermee: true }
    });
    await this.prisma.player.updateMany({
      where: { tableId: fromTableId, tournamentId: t.id },
      data: { tableId: null, siege: null }
    });
  
    // Broadcast nouvelle state
    this.gateway.emitTournamentState(code, await this.getTournamentStatePayload(code));
    return { ok: true };
  }

  async fullRedistributeAndCloseTable(code: string, token: string, fromTableId: number) {
    const t = await this.findWithToken(code, token);
  
    // 1. Libère tous les joueurs de la table à fermer AVANT tout
    await this.prisma.player.updateMany({
      where: { tournamentId: t.id, tableId: fromTableId },
      data: { tableId: null, siege: null }
    });
  
    // 2. Récupère les tables non fermées (hors table à fermer)
    const tables = await this.prisma.table.findMany({
      where: {
        tournamentId: t.id,
        fermee: false,
        NOT: { id: fromTableId }
      },
      include: { players: { where: { is_out: false } }, tournament: true }
    });
  
    // 3. Récupère les joueurs à répartir (ceux qui étaient sur fromTableId, encore en jeu)
    const players = await this.prisma.player.findMany({
      where: { tournamentId: t.id, tableId: null, is_out: false }
    });
  
    // 4. Mélange aléatoirement
    for (let i = players.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [players[i], players[j]] = [players[j], players[i]];
    }
  
    // 5. Répartition round-robin sur les tables les moins remplies
    for (const player of players) {
      const tablesSorted = tables
        .map(tbl => ({
          ...tbl,
          active: tbl.players.filter(p => p.siege != null && !p.is_out).length
        }))
        .sort((a, b) => a.active - b.active);
  
      const table = tablesSorted[0];
  
      const occupied = new Set(table.players.filter(p => p.siege != null && !p.is_out).map(p => p.siege));
      let possibleSeats: number[] = [];
      for (let i = 1; i <= t.joueurs_par_table; i++) {
        if (!occupied.has(i)) possibleSeats.push(i);
      }
      if (possibleSeats.length === 0) throw new Error('Plus de sièges libres !');
  
      const seat = possibleSeats[Math.floor(Math.random() * possibleSeats.length)];
  
      await this.prisma.player.update({
        where: { id: player.id },
        data: { tableId: table.id, siege: seat }
      });
  
      // Mets à jour la table locale pour la suite du round robin
      table.players.push({ ...player, siege: seat });
    }
  
    // 6. Ferme la table à la toute fin
    await this.prisma.table.update({
      where: { id: fromTableId },
      data: { fermee: true }
    });
  
    // 7. Broadcast
    this.gateway.server.to(code).emit('tableRedistributed', { table: fromTableId });
    this.gateway.emitTournamentState(code, await this.getTournamentStatePayload(code));
    return { ok: true };
  }

  // --- Rééquilibrage et fin de tournoi ---
  private async handleRebalancing(tournament: Tournament) {
    // Récupère les tables NON FERMÉES
    const tables = await this.prisma.table.findMany({
      where: { tournamentId: tournament.id, fermee: false },
      include: { players: true, tournament: true }
    });
  
    const tablesWithActivePlayers = tables.map(table => ({
      ...table,
      activePlayers: table.players.filter(p => !p.is_out)
    }));

    // Liste des joueurs restants
    const allActivePlayers = tablesWithActivePlayers.flatMap(t => t.activePlayers);

    // Liste unique des tables des joueurs restants
    const tablesOfActivePlayers = [
      ...new Set(allActivePlayers.map(p => p.tableId))
    ];
    
    // Si tous les joueurs sont déjà sur UNE SEULE table, alors c’est déjà la finale
    if (tablesOfActivePlayers.length === 1) {
      // Plus de redistribution à faire, on sort direct !
      return;
    }
    // Liste des tables non fermées, triées par nombre de joueurs actifs croissant
    const tablesSorted = tablesWithActivePlayers.sort((a, b) => a.activePlayers.length - b.activePlayers.length);
  
    // ---- FINALE AUTOMATIQUE : tous les joueurs peuvent tenir sur une seule table ----
    for (const table of tablesSorted) {
      if (allActivePlayers.length <= table.tournament.joueurs_par_table) {
        // On peut tout mettre sur CETTE table
        // On va demander un "full_redistribute_finale" avec la liste de tous les joueurs et la table cible
        this.gateway.emitRebalancingNeeded(tournament.code, {
          type: 'full_redistribute_finale',
          targetTable: table.id,
          playerIds: allActivePlayers.map(p => p.id),
          auto: true // pour le front, mode auto
        });
        // Pause bien la clock pour tout le monde !
        await this.pauseTournamentByCode(tournament.code);
        return;
      }
    }
  
    // Calcul min/max
    const tableCounts = tablesWithActivePlayers.map(table => table.activePlayers.length);
    const maxPlayers = Math.max(...tableCounts);
    const minPlayers = Math.min(...tableCounts);
  
    // Tables actives
    const tablesWithPlayers = tablesWithActivePlayers.filter(t => t.activePlayers.length > 0);
    if (tablesWithPlayers.length <= 1) return; // rien à rééquilibrer
  
    // 1. Cas FULL REDISTRIBUTE : une table minoritaire à vider, puis fermer
    // - On cherche si une table a moins de joueurs que toutes les autres (et n'est pas déjà fermée)
    // - On vérifie qu'on a assez de sièges sur les autres tables
    const minorityTables = tablesWithActivePlayers.filter(t => t.activePlayers.length === minPlayers && t.activePlayers.length > 0);
    if (minorityTables.length === 1 && tablesWithActivePlayers.length >= 2 && minorityTables[0].activePlayers.length > 0) {
      const tableToClose = minorityTables[0];
      const playerIds = tableToClose.activePlayers.map(p => p.id);
      // Combien de places libres sur les autres tables ?
      const toTables = tablesWithActivePlayers
        .filter(t => t.id !== tableToClose.id)
        .map(t => {
          const occupied = t.players.filter(p => !p.is_out && p.siege != null).map(p => p.siege);
          const freeSeats: number[] = [];
          for (let i = 1; i <= t.tournament.joueurs_par_table; i++) {
            if (!occupied.includes(i)) freeSeats.push(i);
          }
          return { id: t.id, freeSeats: freeSeats.length };
        });
      const totalFree = toTables.reduce((acc, t) => acc + t.freeSeats, 0);
      if (totalFree >= playerIds.length) {
        // On peut tout redispatcher !
        this.gateway.emitRebalancingNeeded(tournament.code, {
          type: 'full_redistribute',
          fromTable: tableToClose.id,
          playerIds,
          toTables,
          auto: true // <<-- pour le front, mode auto
        });
        await this.pauseTournamentByCode(tournament.code);
        return;
      }
    }
  
    // 2. Cas classique : écart ≥2 sur 2 tables
    if (maxPlayers - minPlayers > 1) {
      const tableFrom = tablesWithActivePlayers.find(t => t.activePlayers.length === maxPlayers);
      const tableTo = tablesWithActivePlayers.find(t => t.activePlayers.length === minPlayers);
      this.gateway.emitRebalancingNeeded(tournament.code, {
        type: 'move_one',
        fromTable: tableFrom?.id,
        toTable: tableTo?.id,
        candidates: tableFrom?.activePlayers.map(p => ({ id: p.id, nom: p.nom, pseudo: p.pseudo })),
      });
      await this.pauseTournamentByCode(tournament.code);
      return;
    }
  }

  private async pauseTournamentByCode(code: string) {
    // Va chercher le tournoi + clock
    const t = await this.prisma.tournament.findUnique({ where: { code } });
    if (!t) return;
    const clock = await this.prisma.clock.findUnique({ where: { tournamentId: t.id } });
    if (!clock) return;
  
    // Calcule le temps écoulé depuis le début du niveau courant
    const now = new Date();
    const secondsElapsed = Math.floor((now.getTime() - new Date(clock.levelStartAt).getTime()) / 1000);
    const newElapsed = clock.elapsed + (clock.paused ? 0 : secondsElapsed);
  
    await this.prisma.clock.update({
      where: { tournamentId: t.id },
      data: { elapsed: newElapsed, paused: true }
    });
  
    await this.prisma.tournament.update({ where: { id: t.id }, data: { etat: 'pause' } });
    await this.prisma.tournamentState.create({ data: { tournamentId: t.id, etat: 'pause' } });
    this.gateway.emitTournamentState(code, await this.getTournamentStatePayload(code));
  }

  private async checkIfFinished(t: Tournament) {
    const stillIn = await this.prisma.player.count({ where: { tournamentId: t.id, is_out: false } });
    if (stillIn === 1) {
      // Tournoi terminé !
      await this.prisma.tournament.update({ where: { id: t.id }, data: { etat: 'finished' } });
      this.gateway.emitTournamentState(t.code, await this.getTournamentStatePayload(t.code));
      this.gateway.emitLeaderboardUpdated(t.code, await this.getLeaderboard(t.id));
    }
  }

  // Récupérer l’état pour le front (incluant la clock)
  private async getTournamentStatePayload(code: string) {
    const t = await this.prisma.tournament.findUnique({
      where: { code },
      include: {
        blind_levels: { orderBy: { niveau: 'asc' } },
        players: { include: { table: true } },
        tables: {where: { fermee: false }, include: { players: { where: {is_out: false}} } },
        clock: true
      }
    });
    return t;
  }

  async fullFinalTableRedistribute(code: string, token: string, targetTableId: number) {
    const t = await this.findWithToken(code, token);
  
    // Récupère tous les joueurs encore actifs
    const players = await this.prisma.player.findMany({
      where: { tournamentId: t.id, is_out: false }
    });
  
    // Mélange aléatoirement tous les joueurs
    for (let i = players.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [players[i], players[j]] = [players[j], players[i]];
    }
  
    // Assigne tous les joueurs à targetTableId, sièges random
    let usedSeats = new Set<number>();
    for (const player of players) {
      // Tire un siège libre
      let seat;
      do {
        seat = Math.floor(Math.random() * t.joueurs_par_table) + 1;
      } while (usedSeats.has(seat));
      usedSeats.add(seat);
  
      await this.prisma.player.update({
        where: { id: player.id },
        data: { tableId: targetTableId, siege: seat }
      });
    }
  
    // Ferme toutes les autres tables
    await this.prisma.table.updateMany({
      where: { tournamentId: t.id, id: { not: targetTableId }, fermee: false },
      data: { fermee: true }
    });
  
    // Optionnel : retire tous les joueurs des anciennes tables, sécurité
    await this.prisma.player.updateMany({
      where: { tournamentId: t.id, tableId: { not: targetTableId } },
      data: { tableId: targetTableId }
    });
  
    // Broadcast nouvelle state
    this.gateway.server.to(code).emit('finalTableRedistributed', {});
    this.gateway.emitTournamentState(code, await this.getTournamentStatePayload(code));
    return { ok: true };
  }
  

  private async getLeaderboard(tournamentId: number) {
    // Calcule le leaderboard avec le classement (le 1er restant, puis ordre d’élimination)
    const players = await this.prisma.player.findMany({
      where: { tournamentId },
      orderBy: [
        { is_out: 'asc' }, // encore en jeu d’abord
        { updated_at: 'desc' }, // dernier éliminé en premier
      ],
      select: { id: true, nom: true, pseudo: true, is_out: true, recaves: true }
    });
    return players;
  }
}
