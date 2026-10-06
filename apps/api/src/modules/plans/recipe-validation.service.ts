import { Injectable, Logger } from '@nestjs/common';
import { RecipeRepository, type DuplicateCandidate } from '../recipe/recipe.repository';
import { normalizeRecipeTitle } from '../recipe/recipe-fingerprint.util';
import { findExcludedIngredient, forbiddenRestrictions, restrictionTexts } from '../recipe/validation/ingredient-dictionary';
import { validateRecipe } from '../recipe/validation/validate-recipe';
import type {
  ValidationErrorCode,
  ValidationResult,
  ValidationStage,
  ValidationWarningCode,
} from '../recipe/validation/recipe-validation.types';
import { PlansRepository } from './plans.repository';

// GenerationRun cuyo output se valida: lo justo para registrar el resultado y el log.
export interface ValidatedRun {
  id: string;
  userId: string;
  provider: string;
  model: string;
}

// Rechazos que no vienen del validador puro: el envoltorio de la comida/plan y los criterios del body.
type CallerRejectionCode = 'AI_INVALID_SCHEMA' | 'CRITERIA_NOT_MET';

// validationSnapshot de un run rechazado (NUT-75).
export interface RunValidationSummary {
  stage: ValidationStage | 'passed' | 'criteria';
  codes: Array<ValidationErrorCode | CallerRejectionCode>;
  warnings: ValidationWarningCode[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Una comida del plan o del reemplazo como input del validador: la receta, los macros de la
// comida y su título (que también se revisa por restricciones).
export function mealToDraftInput(meal: unknown): Record<string, unknown> {
  if (!isObject(meal)) return {};
  return {
    ...(isObject(meal.recipe) ? meal.recipe : {}),
    ...(meal.nutritionalValues !== undefined ? { nutritionalValues: meal.nutritionalValues } : {}),
    ...(meal.title !== undefined ? { mealTitle: meal.title } : {}),
  };
}

// Orquesta el validador determinístico de NUT-74: busca los posibles duplicados en el catálogo,
// valida y registra los rechazos en el GenerationRun. Nunca escribe dominio (recetas, planes). El
// resumen de un resultado aceptado lo guarda la transacción que confirma el run.
@Injectable()
export class RecipeValidationService {
  private readonly logger = new Logger(RecipeValidationService.name);

  constructor(
    private readonly recipes: RecipeRepository,
    private readonly plans: PlansRepository,
  ) {}

  // Un resultado por draft. Cada uno se valida por separado: repetir una comida en el plan es normal.
  async validateDrafts(drafts: readonly unknown[], profile: { excludedIngredients?: unknown }): Promise<ValidationResult[]> {
    const excludedIngredients = forbiddenRestrictions(profile);
    const ctx = { excludedIngredients, catalog: await this.reusableCatalog(drafts, excludedIngredients) };
    return drafts.map(draft => validateRecipe(draft, ctx));
  }

  // Contenido rechazado: run PENDING → REJECTED con el primer código y el resumen, y un log por código.
  async reject(run: ValidatedRun, summary: RunValidationSummary): Promise<void> {
    for (const code of summary.codes) {
      // Nunca el prompt, el perfil ni el texto generado: sólo lo necesario para contar rechazos.
      this.logger.warn({ event: 'recipe_validation_rejected', code, provider: run.provider, model: run.model, generationRunId: run.id });
    }
    let updated = 0;
    try {
      updated = await this.plans.transitionGenerationRun(run.id, run.userId, ['PENDING'], 'REJECTED', {
        errorCode: summary.codes[0],
        validationSnapshot: { ...summary },
      });
    } catch {
      // Se prioriza devolver el 422 al cliente; el run lo libera después el TTL de PENDING.
    }
    if (updated === 0) {
      // Sin el mensaje del error: podría incluir datos del payload.
      this.logger.warn({ event: 'recipe_validation_reject_persist_failed', generationRunId: run.id });
    }
  }

  // Rechazo del envoltorio (AI_INVALID_SCHEMA) o de los criterios del body (CRITERIA_NOT_MET).
  rejectWithCode(run: ValidatedRun, code: CallerRejectionCode): Promise<void> {
    return this.reject(run, { stage: code === 'AI_INVALID_SCHEMA' ? 'schema' : 'criteria', codes: [code], warnings: [] });
  }

  // Sólo las recetas del catálogo con el mismo título normalizado que algún draft, y nunca una que
  // viole las restricciones del perfil (su descripción o sus pasos podrían mencionar un alérgeno
  // que la huella no ve).
  private async reusableCatalog(drafts: readonly unknown[], excludedIngredients: string[]): Promise<DuplicateCandidate[]> {
    const titles = drafts
      .map(draft => (isObject(draft) && typeof draft.title === 'string' ? normalizeRecipeTitle(draft.title) : ''))
      .filter(Boolean);
    if (titles.length === 0) return [];

    const candidates = await this.recipes.findByNormalizedTitles([...new Set(titles)]);
    return candidates.filter(recipe => !findExcludedIngredient(restrictionTexts(recipe), excludedIngredients));
  }
}
