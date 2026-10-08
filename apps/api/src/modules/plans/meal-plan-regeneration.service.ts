import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NutritionProfile } from '../../generated/prisma/client';
import { canonicalJson, computeIdempotencyKeyHash } from '../../utils/idempotency-hash.util';
import { RegenerateMealPlanDto } from './dto';
import { GEMINI_MODEL_NAME, GEMINI_PROVIDER } from './gemini/gemini.service';
import { CURRENT_PROMPT_VERSION } from './gemini/prompts';
import { buildProfileSnapshot } from './generation-run-snapshot';
import { isStalePendingRun } from './generation-run-ttl';
import { toPublicMealPlan } from './meal-plan-response';
import { PlansRepository } from './plans.repository';
import { firstDifferentProposal, hasMaterialChange } from './proposal-difference';
import { RecipeImagesService } from './recipe-images.service';
import { RecipeValidationService } from './recipe-validation.service';
import { WeeklyProposalComposer } from './weekly-proposal.composer';

const KIND = 'MEAL_PLAN_REGENERATION';

// Regenera la semana como una versión nueva del plan, conservando la anterior (NUT-78).
// Orden: dueño → perfil → idempotencia → plan current → composición → transacción única.
@Injectable()
export class MealPlanRegenerationService {
  private readonly logger = new Logger(MealPlanRegenerationService.name);

  constructor(
    private readonly repository: PlansRepository,
    private readonly config: ConfigService,
    private readonly composer: WeeklyProposalComposer,
    // Imágenes de NUT-83: buscar antes de la transacción, registrar el uso después del commit.
    private readonly images: RecipeImagesService,
    private readonly validation: RecipeValidationService,
  ) {}

  async regenerate(userId: string, planId: string, idempotencyKey: string, dto: RegenerateMealPlanDto) {
    // 1. El plan existe (404) y es del usuario (403).
    const plan = await this.repository.findPlanWithMeals(planId);
    if (!plan) throw new NotFoundException('Meal plan not found');
    if (plan.userId !== userId) throw new ForbiddenException('This meal plan belongs to another user');

    const user = await this.repository.getUserWithProfile(userId);
    if (!user?.nutritionProfile) throw new BadRequestException('User needs a nutrition profile');
    const profile = user.nutritionProfile;

    // 2. Idempotencia: la misma Idempotency-Key siempre cae en el mismo GenerationRun.
    const requestSnapshot = {
      kind: KIND,
      planId,
      reason: dto.reason,
      weekStart: plan.startDate.toISOString().split('T')[0],
      promptVersion: CURRENT_PROMPT_VERSION.version,
      schemaVersion: CURRENT_PROMPT_VERSION.schemaVersion,
    };
    const idempotencyKeyHash = computeIdempotencyKeyHash({ userId, kind: KIND, requestSnapshot: { idempotencyKey } });
    const createOrRecoverRun = () => this.repository.createOrRecoverGenerationRun(
      userId,
      KIND,
      GEMINI_PROVIDER,
      GEMINI_MODEL_NAME,
      CURRENT_PROMPT_VERSION.version,
      CURRENT_PROMPT_VERSION.schemaVersion,
      requestSnapshot,
      buildProfileSnapshot(profile),
      idempotencyKeyHash,
    );
    let { run, wasCreated } = await createOrRecoverRun();

    // Un intento anterior quedó colgado (mismo TTL que NUT-77): EXPIRED libera la clave y se sigue de cero.
    if (!wasCreated && isStalePendingRun(run, this.config)) {
      await this.repository.transitionGenerationRun(run.id, userId, ['PENDING'], 'EXPIRED', { errorCode: 'PENDING_TIMEOUT' });
      ({ run, wasCreated } = await createOrRecoverRun());
    }

    if (!wasCreated) {
      return this.replayExistingRun(run, requestSnapshot, userId);
    }

    // 3. Sólo se regenera la versión current de la semana.
    if (!plan.isCurrent) {
      await this.failRun(run.id, userId, 'REJECTED', 'PLAN_NOT_CURRENT');
      throw new ConflictException('Only the current version of the plan can be regenerated');
    }

    // Desde acá, un error inesperado deja el run FAILED (nunca PENDING). Los HttpException ya
    // registraron su propio resultado (REJECTED, FAILED por proveedor o por la transacción).
    try {
      return await this.regenerateForRun(userId, run.id, plan, profile, requestSnapshot.weekStart);
    } catch (error) {
      // Siempre se intenta: sólo afecta runs todavía PENDING (los demás ya registraron su resultado).
      await this.failRun(run.id, userId, 'FAILED', 'UNEXPECTED_ERROR');
      throw error;
    }
  }

  // Misma clave ya usada: mismo pedido y terminado → la misma versión nueva; pedido distinto o en curso → 409.
  private async replayExistingRun(run: any, requestSnapshot: unknown, userId: string) {
    if (canonicalJson(run.requestSnapshot) !== canonicalJson(requestSnapshot)) {
      throw new ConflictException('This Idempotency-Key was already used for a different request');
    }
    if (run.status !== 'SUCCEEDED') {
      throw new ConflictException('A regeneration with this Idempotency-Key is already in progress');
    }

    // Esa versión puede haber sido reemplazada después: se devuelve igual, por su generationRunId.
    const version = await this.repository.findPlanByGenerationRunId(run.id, userId);
    if (!version) throw new ConflictException('The plan version for this Idempotency-Key is no longer available');
    return toPublicMealPlan(version);
  }

  private async regenerateForRun(userId: string, runId: string, plan: any, profile: NutritionProfile, weekStartStr: string) {
    const run = { id: runId, userId, provider: GEMINI_PROVIDER, model: GEMINI_MODEL_NAME };

    // 4. Propuesta nueva validada (NUT-74) y "materialmente nueva": al menos una franja distinta de la
    // versión anterior. Hasta 2 generaciones; un 422 de validación o un 503 cortan sin reintentar.
    const proposal = await firstDifferentProposal(
      () => this.composer.composeWeeklyProposal({ userId, runId, profile, weekStart: plan.startDate, weekStartStr }),
      candidate => hasMaterialChange(plan.days, candidate.comparableDays),
    );
    if (!proposal) {
      await this.validation.rejectWithCode(run, 'NO_DIFFERENT_PROPOSAL');
      throw new UnprocessableEntityException('Could not produce a different valid proposal for this week (NO_DIFFERENT_PROPOSAL)');
    }

    // 5. Fotos de las recetas nuevas, antes de la transacción (nunca hay red dentro de ella).
    const daysForPersistence = await this.images.resolveImagesOrDegrade(proposal.dto.days);

    // 6. Transacción única: la anterior deja de ser current, se crea la nueva y el run pasa a SUCCEEDED.
    // Si algo falla, Prisma revierte todo y la anterior sigue current.
    let recipesForTracking;
    try {
      ({ recipesForTracking } = await this.repository.updatePlanTransaction(userId, plan.startDate, daysForPersistence, runId, {
        expectedPlanId: plan.id,
        // Control optimista como NUT-77: si el plan cambió desde que se leyó (por ejemplo, un reemplazo), 409.
        expectedPlanUpdatedAt: plan.updatedAt,
        recipeOrigin: 'AI',
        validationSnapshot: { ...proposal.summary },
      }));
    } catch (error) {
      const conflict = error instanceof ConflictException;
      await this.failRun(runId, userId, 'FAILED', conflict ? 'CONCURRENT_CONFLICT' : 'DOMAIN_TRANSACTION_FAILED');
      throw error;
    }

    // 7. Uso de las fotos nuevas, después del commit (NUT-83). La versión nueva, completa.
    await this.images.trackNewRecipeImages(recipesForTracking);
    const created = await this.repository.findPlanByGenerationRunId(runId, userId);
    if (!created) throw new ConflictException('The new plan version is no longer available');
    return toPublicMealPlan(created);
  }

  // Mismo orden que el resto del módulo (status, errorCode). Si no se puede marcar el run, se devuelve
  // el error original y queda un log (sin el mensaje del error); el TTL de PENDING lo libera después.
  private async failRun(runId: string, userId: string, status: 'FAILED' | 'REJECTED', errorCode: string) {
    try {
      await this.repository.transitionGenerationRun(runId, userId, ['PENDING'], status, { errorCode });
    } catch {
      this.logger.warn({ event: 'generation_run_fail_persist_failed', generationRunId: runId, errorCode });
    }
  }

}
