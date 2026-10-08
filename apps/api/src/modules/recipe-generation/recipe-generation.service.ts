import { ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NutritionProfileRepository } from '@/modules/nutrition-profile/nutrition-profile.repository';
import { RecipeCoverageService } from '@/modules/recipe/recipe-coverage.service';
import { normalizeRecipeTitle } from '@/modules/recipe/recipe-fingerprint.util';
import { RecipeRepository } from '@/modules/recipe/recipe.repository';
import { forbiddenRestrictions } from '@/modules/recipe/validation/ingredient-dictionary';
import { parseGeneratedOutput } from '@/modules/recipe/validation/parse-generated-output';
import type { RecipeDraft, RecipeValidationContext, ValidationError, ValidationResult, ValidationWarning } from '@/modules/recipe/validation/recipe-validation.types';
import { reusableDuplicate, summarizeParseFailure, summarizeResults, validateRecipes } from '@/modules/recipe/validation/validate-recipe';
import { UnsplashService } from '@/modules/unsplash/unsplash.service';
import { normalizeProperties } from '@/utils/normalize-properties.util';
import { ConfirmGeneratedRecipesDto } from './dto/confirm-generated-recipes.dto';
import { GeneratedRecipeCountMode, PreviewGeneratedRecipesDto } from './dto/preview-generated-recipes.dto';
import { RECIPE_GENERATION_PROVIDER, RecipeGenerationProvider } from './recipe-generation.ports';
import { RecipeGenerationRepository } from './recipe-generation.repository';

const PROMPT_VERSION = 'recipe-preview-v1';
const SCHEMA_VERSION = 'recipe-candidate-v1';
type RecipeCoveragePort = { evaluate(input: any): Promise<any> };
type PersistedDraft = { draftId: string; recipe: RecipeDraft; image: Record<string, unknown> | null; warnings: Array<ValidationWarning | { code: 'IMAGE_UNAVAILABLE'; message: string }> };
type RejectedCandidate = { candidateIndex: number | null; codes: string[]; errors?: Array<Pick<ValidationError, 'code' | 'field' | 'message'>> };

@Injectable()
export class RecipeGenerationService {
  constructor(
    private readonly repository: RecipeGenerationRepository,
    private readonly coverage: RecipeCoveragePort,
    @Inject(RECIPE_GENERATION_PROVIDER) private readonly provider: RecipeGenerationProvider,
    private readonly recipes: RecipeRepository,
    private readonly profiles: NutritionProfileRepository,
    private readonly images: UnsplashService,
  ) {}

  async preview(userId: string, idempotencyKey: string, dto: PreviewGeneratedRecipesDto) {
    const criteria = this.normalizedCriteria(dto);
    const requestSnapshot = { mode: dto.mode, countMode: dto.countMode, count: dto.count, ...criteria };
    const kind = dto.mode === 'SINGLE' ? 'RECIPE_SINGLE' : 'RECIPE_BATCH';
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const reserved = await this.repository.createOrRecoverPreviewRun({ userId, idempotencyKey, kind, requestSnapshot, profileSnapshot: {}, expiresAt, promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION });
    if (!reserved.wasCreated) {
      if ((reserved.run.status === 'READY_FOR_REVIEW' || reserved.run.status === 'CONFIRMED') && reserved.run.outputSnapshot) return this.publicPreview(reserved.run.outputSnapshot);
      throw new ConflictException('Recipe preview is already being generated');
    }

    let profile: any;
    let reused: unknown[] = [];
    let requestedCount = dto.count;
    try {
      if (dto.countMode === GeneratedRecipeCountMode.TOTAL_DESIRED) {
        const evaluation = await this.coverage.evaluate({ userId, desiredTotal: dto.count, ...criteria });
        profile = evaluation.profile;
        reused = evaluation.result.compatibleRecipes;
        requestedCount = evaluation.result.missingCount;
      } else {
        profile = await this.profiles.findByUserId(userId);
      }
    } catch {
      await this.repository.failPreview({ runId: reserved.run.id, userId, code: 'TRANSIENT' });
      throw new ServiceUnavailableException('Recipe coverage is temporarily unavailable');
    }
    if (requestedCount === 0) {
      return this.publicPreview(await this.repository.persistReadyPreview({
        runId: reserved.run.id, userId, kind, reused, drafts: [], rejected: [], validationSnapshot: { stage: 'passed', codes: [], warnings: [] }, profileSnapshot: this.profileSnapshot(profile), expiresAt,
      }));
    }

    let raw: string;
    try {
      raw = await this.provider.generate({ profile: this.profileSnapshot(profile), criteria, count: requestedCount, promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION });
    } catch (error) {
      const code = this.providerFailureCode(error);
      await this.repository.failPreview({ runId: reserved.run.id, userId, code });
      if (code === 'RATE_LIMITED') throw new HttpException('Recipe provider is temporarily rate limited', HttpStatus.TOO_MANY_REQUESTS);
      throw new ServiceUnavailableException('Recipe provider is temporarily unavailable');
    }
    const parsed = parseGeneratedOutput(raw, requestedCount);
    if (!parsed.ok) {
      await this.reject(reserved.run.id, userId, [{ candidateIndex: null, codes: parsed.errors.map(error => error.code), errors: this.safeErrors(parsed.errors) }], summarizeParseFailure(parsed.errors));
      return;
    }

    const catalog = await this.catalogFor(parsed.value);
    const context: RecipeValidationContext = { excludedIngredients: forbiddenRestrictions(profile ?? {}), catalog };
    const results = validateRecipes(parsed.value, context);
    const valid: Array<{ recipe: RecipeDraft; warnings: ValidationWarning[] }> = [];
    const rejected: RejectedCandidate[] = [];
    for (const [candidateIndex, result] of results.entries()) {
      if (result.valid) { valid.push({ recipe: result.normalizedRecipe, warnings: result.warnings }); continue; }
      const reusable = reusableDuplicate(result);
      if (reusable) {
        const recipe = catalog.find(item => item.id === reusable.recipeId);
        if (recipe) reused.push({ recipe, reusedFromValidation: true });
      } else rejected.push({ candidateIndex, codes: result.errors.map(error => error.code), errors: this.safeErrors(result.errors) });
    }
    const validationSnapshot = summarizeResults(results);
    if (!valid.length && !reused.length) await this.reject(reserved.run.id, userId, rejected, validationSnapshot);
    const drafts = await this.resolveDraftImages(valid);
    return this.publicPreview(await this.repository.persistReadyPreview({ runId: reserved.run.id, userId, kind, reused, drafts, rejected, validationSnapshot, profileSnapshot: this.profileSnapshot(profile), expiresAt }));
  }

  async confirm(userId: string, idempotencyKey: string, dto: ConfirmGeneratedRecipesDto) {
    const owned = await this.repository.findRunForOwner(dto.generationRunId, userId);
    if (!owned) {
      if (await this.repository.findRunById(dto.generationRunId)) throw new ForbiddenException();
      throw new NotFoundException();
    }
    if (owned.status === 'CONFIRMED') {
      const replay = await this.repository.confirmDraftsTransaction({ userId, generationRunId: dto.generationRunId, draftIds: dto.draftIds, idempotencyKey });
      return { generationRunId: replay.generationRunId, items: replay.items.map((item: any) => ({ id: item.id, image: this.publicImage(item.image) })) };
    }
    const selected = this.repository.selectedDrafts(owned.outputSnapshot, dto.draftIds);
    const profile = await this.profiles.findByUserId(userId);
    const catalog = await this.catalogFor(selected.map(draft => draft.recipe));
    const results = validateRecipes(selected.map(draft => draft.recipe), { excludedIngredients: forbiddenRestrictions(profile ?? {}), catalog });
    if (results.some(result => !result.valid)) throw new UnprocessableEntityException('Selected recipe can no longer be safely validated');
    const normalized = results.map((result, index) => ({ ...selected[index], recipe: (result as Extract<ValidationResult, { valid: true }>).normalizedRecipe }));
    const result = await this.repository.confirmDraftsTransaction({ userId, generationRunId: dto.generationRunId, draftIds: dto.draftIds, idempotencyKey, drafts: normalized });
    if (!result.replayed) await Promise.all(result.items.map(async (item: any) => {
      if (!item.image) return;
      try { const tracked = await this.images.trackDownload(item.image); if (tracked) await this.repository.updateRecipeImageTracking(item.id, tracked); } catch { /* post-commit best effort */ }
    }));
    return { generationRunId: result.generationRunId, items: result.items.map((item: any) => ({ id: item.id, image: this.publicImage(item.image) })) };
  }

  private async catalogFor(candidates: readonly unknown[]) {
    const titles = candidates.flatMap(candidate => typeof candidate === 'object' && candidate !== null && typeof (candidate as any).title === 'string' ? [normalizeRecipeTitle((candidate as any).title)] : []);
    return this.recipes.findByNormalizedTitles(titles);
  }
  private profileSnapshot(profile: any) { return { diet: profile?.diet, excludedIngredients: forbiddenRestrictions(profile ?? {}), cookTimePreference: profile?.cookTimePreference, goal: profile?.goal }; }
  private normalizedCriteria(dto: PreviewGeneratedRecipesDto) { return { topic: dto.topic?.trim(), description: dto.description?.trim(), categories: dto.categories ?? [], properties: normalizeProperties(dto.properties ?? []), maxPrepMinutes: dto.maxPrepMinutes }; }
  private async reject(runId: string, userId: string, rejected: RejectedCandidate[], validationSnapshot: any): Promise<never> {
    await this.repository.rejectPreview({ runId, userId, code: validationSnapshot.codes[0] ?? 'VALIDATION_REJECTED', rejected, validationSnapshot });
    throw new UnprocessableEntityException('Generated recipe could not be safely validated');
  }
  private providerFailureCode(error: unknown): string { const code = typeof (error as any)?.code === 'string' ? (error as any).code : ''; return code === 'RATE_LIMITED' || code === 'TIMEOUT' || code === 'TRANSIENT' ? code : 'TRANSIENT'; }
  private safeErrors(errors: readonly ValidationError[]) { return errors.map(({ code, field, message }) => ({ code, ...(field ? { field } : {}), message })); }
  private async resolveDraftImages(candidates: Array<{ recipe: RecipeDraft; warnings: ValidationWarning[] }>): Promise<PersistedDraft[]> {
    const drafts: PersistedDraft[] = new Array(candidates.length); let next = 0;
    const worker = async () => { for (;;) { const index = next++; if (index >= candidates.length) return; const candidate = candidates[index]; try { drafts[index] = { draftId: randomUUID(), recipe: candidate.recipe, image: await this.images.searchAndSelectCandidate(candidate.recipe.title), warnings: candidate.warnings }; } catch { drafts[index] = { draftId: randomUUID(), recipe: candidate.recipe, image: null, warnings: [...candidate.warnings, { code: 'IMAGE_UNAVAILABLE', message: 'Recipe image is unavailable' }] }; } } };
    await Promise.all(Array.from({ length: Math.min(3, candidates.length) }, worker)); return drafts;
  }
  private publicImage(image: any): any { if (!image) return null; const { tracking: _tracking, ...publicImage } = image; return publicImage; }
  private publicPreview(value: any): any { return this.removeTracking(value); }
  private removeTracking(value: any): any { if (Array.isArray(value)) return value.map(item => this.removeTracking(item)); if (!value || typeof value !== 'object') return value; const { tracking: _tracking, ...rest } = value; return Object.fromEntries(Object.entries(rest).map(([key, item]) => [key, this.removeTracking(item)])); }
}
