import { Controller, Post, Get, Body, Param, Headers, UnauthorizedException, Patch, Delete } from '@nestjs/common';
import { TournamentsService } from './tournaments.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { UpdateTournamentDto } from './dto/update-tournament.dto';
import { SeatChangeDto } from './dto/seat-change.dto';
import { EliminatePlayerDto } from './dto/eliminated-player.dto';

@Controller('tournaments')
export class TournamentsController {
  constructor(private readonly tournamentsService: TournamentsService) {}

  // POST /tournaments
  @Post()
  async createTournament(@Body() dto: CreateTournamentDto) {
    return this.tournamentsService.createTournament(dto);
  }

  @Patch(':code')
  async updateTournament(
    @Param('code') code: string,
    @Headers('authorization') auth: string,
    @Body() updates: UpdateTournamentDto
  ) {
    const token = auth?.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('Token admin manquant.');
    return this.tournamentsService.updateTournament(code, token, updates);
  }

  @Delete(':code/player/:playerId')
  async removePlayer(
    @Param('code') code: string,
    @Param('playerId') playerId: string,
    @Headers('authorization') auth: string
  ) {
    const token = auth?.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('Token admin manquant.');
    return this.tournamentsService.removePlayer(code, token, Number(playerId));
  }

  // GET /tournaments/:code (admin only)
  @Get(':code')
  async getTournament(@Param('code') code: string, @Headers('authorization') auth: string) {
    const token = auth?.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('Token admin manquant.');
    return this.tournamentsService.getTournamentForAdmin(code, token);
  }

  @Post(':code/start')
  async startTournament(
    @Param('code') code: string,
    @Headers('authorization') auth: string,
  ) {
    this.ensureToken(auth);
    return this.tournamentsService.startTournament(code, this.extractToken(auth));
  }

  @Post(':code/pause')
  async pauseTournament(
    @Param('code') code: string,
    @Headers('authorization') auth: string,
  ) {
    this.ensureToken(auth);
    return this.tournamentsService.pauseTournament(code, this.extractToken(auth));
  }

  @Post(':code/resume')
  async resumeTournament(
    @Param('code') code: string,
    @Headers('authorization') auth: string,
  ) {
    this.ensureToken(auth);
    return this.tournamentsService.resumeTournament(code, this.extractToken(auth));
  }

  @Post(':code/eliminate')
  async eliminatePlayer(
    @Param('code') code: string,
    @Headers('authorization') auth: string,
    @Body() dto: EliminatePlayerDto
  ) {
    this.ensureToken(auth);
    return this.tournamentsService.eliminateOrRecavePlayer(code, this.extractToken(auth), dto);
  }

  @Post(':code/seat-change')
  async seatChange(
    @Param('code') code: string,
    @Headers('authorization') auth: string,
    @Body() dto: SeatChangeDto
  ) {
    this.ensureToken(auth);
    return this.tournamentsService.seatChange(code, this.extractToken(auth), dto);
  }

  @Post(':code/close-table')
  async closeTableAndRedistribute(
    @Param('code') code: string,
    @Headers('authorization') auth: string,
    @Body() dto: { fromTableId: number, mapping: { playerId: number, toTableId: number }[] }
  ) {
    this.ensureToken(auth);
    return this.tournamentsService.closeTableAndRedistribute(code, this.extractToken(auth), dto.fromTableId, dto.mapping);
  }

  @Post(':code/full-redistribute')
async fullRedistribute(
  @Param('code') code: string,
  @Headers('authorization') auth: string,
  @Body() dto: { fromTableId: number }
) {
  this.ensureToken(auth);
  return this.tournamentsService.fullRedistributeAndCloseTable(code, this.extractToken(auth), dto.fromTableId);
}

@Post(':code/final-redistribute')
async finalRedistribute(
@Param('code') code: string,
@Headers('authorization') auth: string,
@Body() dto: { toTableId: number }
) {
this.ensureToken(auth);
return this.tournamentsService.fullFinalTableRedistribute(code, this.extractToken(auth), dto.toTableId);
}

  @Post(':code/assign-seats')
  async assignSeats(
    @Param('code') code: string,
    @Headers('authorization') auth: string
  ) {
    this.ensureToken(auth);
    return this.tournamentsService.seatUnassignedPlayers(code, this.extractToken(auth));
  }
  
  @Post(':code/next-level')
  async nextLevel(
    @Param('code') code: string,
    @Headers('authorization') auth: string,
  ) {
    this.ensureToken(auth);
    return this.tournamentsService.nextLevel(code, this.extractToken(auth));
  }
  
  @Post(':code/reset-clock')
  async resetClock(
    @Param('code') code: string,
    @Headers('authorization') auth: string,
  ) {
    this.ensureToken(auth);
    return this.tournamentsService.resetClock(code, this.extractToken(auth));
  }

  private extractToken(auth: string) {
    return auth?.replace(/^Bearer\s+/i, '') ?? '';
  }

  private ensureToken(auth: string) {
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException('Token admin manquant.');
  }
}
