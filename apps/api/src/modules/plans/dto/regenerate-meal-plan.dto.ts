import { IsEnum } from 'class-validator';

// Motivos aceptados para regenerar una semana (NUT-78). En este sprint, sólo a pedido del usuario.
export enum RegenerationReason {
  USER_REQUESTED = 'USER_REQUESTED',
}

// Body de POST /meal-plans/:planId/regenerate.
export class RegenerateMealPlanDto {
  @IsEnum(RegenerationReason)
  reason!: RegenerationReason;
}
