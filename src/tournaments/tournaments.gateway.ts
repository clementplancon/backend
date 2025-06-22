import {
    WebSocketGateway, WebSocketServer,
    OnGatewayConnection, OnGatewayDisconnect,
    SubscribeMessage, MessageBody, ConnectedSocket,
  } from '@nestjs/websockets';
import { PrismaService } from 'prisma/prisma.service';
  import { Server, Socket } from 'socket.io';
  
  @WebSocketGateway({ cors: { origin: '*' } })
  export class TournamentsGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;
  
    private connections: Map<string, { code: string; type: 'admin' | 'player' | 'screen'; }> = new Map();

    constructor(private readonly prisma: PrismaService) {}
  
    handleConnection(socket: Socket) {
      console.log('[WebSocket] Nouvelle connexion', socket.id);
    }
  
    handleDisconnect(socket: Socket) {
      console.log('[WebSocket] Nouvelle déconnexion', socket.id);
      this.connections.delete(socket.id);
    }
  
    @SubscribeMessage('joinTournamentRoom')
    handleJoinRoom(
      @MessageBody() data: { code: string, type: 'admin' | 'player' | 'screen' },
      @ConnectedSocket() client: Socket
    ) {
      client.join(data.code);
      this.connections.set(client.id, { code: data.code, type: data.type });
    }

  // Quand un joueur tente de rejoindre la room via son pseudo
  @SubscribeMessage('playerJoin')
  async handlePlayerJoin(
    @MessageBody() data: { code: string, pseudo: string },
    @ConnectedSocket() client: Socket
  ) {
    const code = data.code;
    const pseudo = data.pseudo.trim();

    const tournament = await this.prisma.tournament.findUnique({
      where: { code },
      include: { players: true, tables: { include: { players: true, tournament: true } }, blind_levels: true, clock: true }
    });
    if (!tournament) {
      client.emit('playerJoinResult', { error: 'Tournoi introuvable.' });
      return;
    }
    if (!tournament.tables || tournament.tables.length === 0) {
        client.emit('playerJoinResult', { error: 'Aucune table dans ce tournoi.' });
        return;
    }

    // Pseudo unique insensible à la casse
    let player = tournament.players.find(
      p => p.pseudo.trim().toLowerCase() === pseudo.toLowerCase()
    );
  
    // ===> AJOUT: check capacity <===
    const joueursActifs = tournament.players.filter(p => !p.is_out).length;
    const capacity = tournament.nb_tables * tournament.joueurs_par_table;
    // Si joueur non inscrit ET tournoi plein, refus
    if (!player && joueursActifs >= capacity) {
      client.emit('playerJoinResult', { error: 'Le tournoi est complet. Impossible de s’inscrire.' });
      return;
    }

    if (!player) {

      // 3. Créer le joueur
      player = await this.prisma.player.create({
        data: {
          tournamentId: tournament.id,
          nom: pseudo, // ou demander le vrai nom ?
          pseudo,
        }
      });
    }

    // (optionnel) Associer le client socket à la room tournoi
    client.join(code);

    // Rafraîchir l’état (joueur tout juste ajouté)
    const newTournament = await this.prisma.tournament.findUnique({
      where: { code },
      include: {
        blind_levels: { orderBy: { niveau: 'asc' } },
        players: { include: { table: true } },
        tables: { include: { players: true } },
        clock: true
      }
    });
    // Envoie au client le nouvel état (player bien inclus)
    client.emit('playerJoinResult', { tournament: newTournament, playerId: player.id });
    // Et broadcast aux autres le nouvel état
    this.server.to(code).emit('tournamentStateUpdated', newTournament);
  }
  
    emitTournamentState(code: string, payload: any) {
      this.server.to(code).emit('tournamentStateUpdated', payload);
    }
    emitBlindsUp(code: string, payload: any) {
      this.server.to(code).emit('blindsUp', payload);
    }
    emitPlayerEliminated(code: string, payload: any) {
      this.server.to(code).emit('playerEliminated', payload);
    }
    emitPlayerRecaved(code: string, payload: any) {
      this.server.to(code).emit('playerRecaved', payload);
    }
    emitRebalancingNeeded(code: string, payload: any) {
      this.server.to(code).emit('rebalancingNeeded', payload);
    }
    emitLeaderboardUpdated(code: string, payload: any) {
      this.server.to(code).emit('leaderboardUpdated', payload);
    }
  }
  