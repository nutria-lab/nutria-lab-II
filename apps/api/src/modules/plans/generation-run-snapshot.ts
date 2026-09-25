import { createHash } from 'crypto';
import { canonicalJson } from '../../utils/idempotency-hash.util';

/**
 * Forma mínima de `NutritionProfile` que necesita `buildProfileSnapshot`. Se declara
 * localmente (en vez de importar el modelo completo generado por Prisma) para dejar
 * explícito, a nivel de tipos, que esta función nunca depende de `id`/`userId`/
 * `createdAt`/`updatedAt`.
 */
interface ProfileSnapshotSource {
  goal: unknown;
  diet: unknown;
  excludedIngredients: unknown;
  cookTimePreference: unknown;
}

export interface ProfileSnapshot {
  goal: unknown;
  diet: unknown;
  excludedIngredients: unknown;
  cookTimePreference: unknown;
}

/**
 * Construye `profileSnapshot` por lista blanca explícita (design.md sección 6): copia
 * únicamente `goal`, `diet`, `excludedIngredients`, `cookTimePreference` del perfil
 * nutricional recibido, sin mutar el objeto original y sin incluir `id`, `userId`,
 * `createdAt` ni `updatedAt` (ni ningún otro campo que el perfil pudiera tener).
 */
export function buildProfileSnapshot(profile: ProfileSnapshotSource): ProfileSnapshot {
  return {
    goal: profile.goal,
    diet: profile.diet,
    excludedIngredients: profile.excludedIngredients,
    cookTimePreference: profile.cookTimePreference
  };
}

export interface RequestSnapshotInput {
  kind: string;
  weekStart: string;
  promptVersion: string;
  schemaVersion: string;
  /**
   * NUT-75 Gap 1 (crítico): sólo se pasa desde el camino de `updatePlan`/
   * `MEAL_PLAN_REGENERATION`, donde el cliente envía `dto.days` en el body. Cuando está
   * presente, `buildRequestSnapshot` agrega `daysFingerprint` al snapshot resultante. Para
   * `MEAL_PLAN_INITIAL` (que no tiene `days` de entrada, sólo `weekStart`) este campo se omite
   * y el shape del snapshot queda exactamente igual que antes.
   */
  days?: unknown;
}

export interface RequestSnapshot {
  kind: string;
  weekStart: string;
  promptVersion: string;
  schemaVersion: string;
  daysFingerprint?: string;
}

/**
 * Construye `requestSnapshot` por lista blanca explícita (design.md sección 6, para los
 * `kind` conectados en esta iteración: `MEAL_PLAN_INITIAL`/`MEAL_PLAN_REGENERATION`): copia
 * únicamente `kind`, `weekStart`, `promptVersion`, `schemaVersion` — nunca texto libre ni PII.
 *
 * NUT-75 Gap 1: cuando `input.days` viene definido (sólo el camino de regeneración/edición),
 * agrega `daysFingerprint` — un hash canónico (SHA-256 sobre `canonicalJson(days)`, mismo
 * mecanismo determinístico que `computeIdempotencyKeyHash`) del contenido normalizado de
 * `days`. Esto hace que dos ediciones de la misma semana con contenido distinto produzcan
 * `requestSnapshot`/`idempotencyKeyHash` distintos, en vez de deduplicarse incorrectamente por
 * compartir sólo `{kind, weekStart, promptVersion, schemaVersion}`.
 */
export function buildRequestSnapshot(input: RequestSnapshotInput): RequestSnapshot {
  const snapshot: RequestSnapshot = {
    kind: input.kind,
    weekStart: input.weekStart,
    promptVersion: input.promptVersion,
    schemaVersion: input.schemaVersion
  };

  if (input.days !== undefined) {
    snapshot.daysFingerprint = createHash('sha256').update(canonicalJson(input.days)).digest('hex');
  }

  return snapshot;
}
