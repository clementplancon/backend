import { Type } from 'class-transformer';
import {
  IsString, IsNotEmpty, IsNumber, IsPositive, IsOptional,
  IsArray, ValidateNested, IsBoolean, IsInt, Min,
} from 'class-validator';

class UpdateBlindeDto {
  @IsOptional()
  @IsInt()
  id?: number;

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

class UpdateJetonDto {
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

export class UpdateTournamentDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  nom?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  stack_initial?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  valeur_cave?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  nb_tables?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  joueurs_par_table?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  recave_max?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  niveau_recave_max?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateJetonDto)
  jetons?: UpdateJetonDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateBlindeDto)
  blindes?: UpdateBlindeDto[];
}
