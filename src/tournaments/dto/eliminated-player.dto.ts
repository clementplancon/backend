import { IsBoolean, IsInt, IsOptional, IsPositive } from 'class-validator';

export class EliminatePlayerDto {
  @IsInt()
  @IsPositive()
  playerId: number;

  @IsOptional()
  @IsBoolean()
  recave?: boolean;
}
