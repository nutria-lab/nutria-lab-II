/**
 * Máquina de estados de `GenerationRun`, definida en código de aplicación (no en la
 * base de datos) como fuente de verdad testeable unitariamente. Ver design.md sección 7
 * para la tabla completa y el razonamiento de por qué vive acá y no en un trigger/constraint.
 *
 * `GenerationStatus` se declara localmente (mismos 7 valores) porque el modelo Prisma
 * `GenerationRun` todavía no existe (pendiente de aprobación de migración por TL) y por
 * lo tanto el cliente Prisma generado no exporta este enum todavía.
 * TODO: una vez que `@/generated/prisma/client` exporte `GenerationStatus`, reemplazar
 * este tipo local por el import del cliente generado.
 */
export type GenerationStatus =
  | 'PENDING'
  | 'READY_FOR_REVIEW'
  | 'CONFIRMED'
  | 'SUCCEEDED'
  | 'REJECTED'
  | 'FAILED'
  | 'EXPIRED';

const VALID_TRANSITIONS: Record<GenerationStatus, GenerationStatus[]> = {
  PENDING: ['READY_FOR_REVIEW', 'SUCCEEDED', 'REJECTED', 'FAILED'],
  READY_FOR_REVIEW: ['CONFIRMED', 'EXPIRED', 'REJECTED'],
  CONFIRMED: [],
  SUCCEEDED: [],
  REJECTED: [],
  FAILED: [],
  EXPIRED: []
};

/**
 * Devuelve `true` si la transición `from -> to` está permitida según la tabla de
 * design.md sección 7. Ningún estado terminal (`CONFIRMED`, `SUCCEEDED`, `REJECTED`,
 * `FAILED`, `EXPIRED`) tiene transiciones válidas salientes, ni siquiera de vuelta a
 * `PENDING`.
 */
export function isValidTransition(from: GenerationStatus, to: GenerationStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}
