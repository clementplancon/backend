import { Type } from 'class-transformer';
import {
  IsString, IsNotEmpty, IsNumber, IsPositive, IsOptional,
  IsArray, ValidateNested, IsBoolean, Min,
} from 'class-validator';

export class JetonDto {
  @IsString()
  @IsNotEmpty()
  couleur: string;

  @IsNumber()
  @IsPositive()
  valeur: number;

  @IsOptional()
  @IsString()
  label?: string;
}

export class BlindeDto {
  @IsNumber()
  @Min(0)
  niveau: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  sb?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  bb?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  ante?: number;

  @IsNumber()
  @IsPositive()
  duree: number;

  @IsOptional()
  @IsBoolean()
  is_pause?: boolean;
}

export class CreateTournamentDto {
  @IsString()
  @IsNotEmpty()
  nom: string;

  @IsNumber()
  @IsPositive()
  stack_initial: number;

  @IsNumber()
  @IsPositive()
  valeur_cave: number;

  @IsNumber()
  @IsPositive()
  nb_tables: number;

  @IsNumber()
  @IsPositive()
  joueurs_par_table: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  recave_max?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  niveau_recave_max?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JetonDto)
  jetons: JetonDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BlindeDto)
  blindes: BlindeDto[];
}
