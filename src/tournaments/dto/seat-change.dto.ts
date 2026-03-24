import { IsInt, IsPositive } from 'class-validator';

export class SeatChangeDto {
  @IsInt()
  @IsPositive()
  fromTableId: number;

  @IsInt()
  @IsPositive()
  toTableId: number;

  @IsInt()
  @IsPositive()
  playerId: number;
}
