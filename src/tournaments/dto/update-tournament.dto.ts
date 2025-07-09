export class UpdateTournamentDto {
    nom?: string;
    stack_initial?: number;
    valeur_cave?: number;
    nb_tables?: number;
    joueurs_par_table?: number;
    recave_max?: number;
    niveau_recave_max?: number;
    jetons?: { couleur: string; valeur: number; label?: string }[];
    blindes: {
      id: number;
      niveau: number;
      sb: number;
      bb: number;
      ante?: number;
      duree: number;
      is_pause?: boolean;
    }[];
  }
  