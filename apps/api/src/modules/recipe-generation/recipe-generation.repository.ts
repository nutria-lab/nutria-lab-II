import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { canonicalJson } from '@/utils/idempotency-hash.util';
import { createHash } from 'crypto';
import type { RecipeDraft as ValidatedRecipeDraft, ValidationSummary, ValidationWarning } from '@/modules/recipe/validation/recipe-validation.types';

type JsonRecord = Record<string, unknown>;
type RecipeDraft = { draftId: string; recipe: ValidatedRecipeDraft; image: JsonRecord | null; warnings: Array<ValidationWarning | { code: 'IMAGE_UNAVAILABLE'; message: string }> };
type RejectedCandidate = { candidateIndex: number | null; codes: string[]; errors?: Array<{ code: string; field?: string; message: string }> };
type ConfirmationResponse = { generationRunId: string; items: Array<{ id: string; image: JsonRecord | null }> };
type RecipePreviewOutputSnapshot = {
  version: 1; requestedCount: number; reused: unknown[]; drafts: RecipeDraft[];
  rejected: RejectedCandidate[];
  confirmation: null | { idempotencyKeyHash: string; requestFingerprint: string; selectedDraftIds: string[]; response: ConfirmationResponse };
};
type PreviewRunInput = {
  userId: string; kind: string; idempotencyKey: string; provider?: string; model?: string;
  promptVersion: string; schemaVersion: string; requestSnapshot?: JsonRecord; criteria?: JsonRecord;
  profileSnapshot?: JsonRecord; expiresAt?: Date | null;
};
type ReadyPreviewInput = {
  runId: string; userId: string; kind: string; reused: unknown[]; drafts: RecipeDraft[];
  rejected?: RejectedCandidate[]; validationSnapshot?: ValidationSummary | JsonRecord; profileSnapshot?: JsonRecord; expiresAt?: Date | null;
};
type ConfirmInput = {
  userId: string; generationRunId: string; draftIds: string[]; idempotencyKey: string;
  confirmKeyHash?: string; requestFingerprint?: string;
  drafts?: RecipeDraft[];
};

const RECIPE_KINDS = ['RECIPE_SINGLE', 'RECIPE_BATCH'];
const sha256 = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const isRecord = (value: unknown): value is JsonRecord => value !== null && typeof value === 'object' && !Array.isArray(value);

function previewHash(input: PreviewRunInput): string {
  return sha256({ userId: input.userId, operation: 'RECIPE_PREVIEW', kind: input.kind, idempotencyKey: input.idempotencyKey });
}

function confirmationHash(input: ConfirmInput): string {
  return input.confirmKeyHash ?? sha256({ userId: input.userId, operation: 'RECIPE_CONFIRM', generationRunId: input.generationRunId, idempotencyKey: input.idempotencyKey });
}

function confirmationFingerprint(input: ConfirmInput): string {
  return input.requestFingerprint ?? sha256({ draftIds: [...input.draftIds].sort() });
}

function parseOutputSnapshot(value: unknown): RecipePreviewOutputSnapshot {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.drafts) || !Array.isArray(value.reused) || !Array.isArray(value.rejected)) {
    throw new UnprocessableEntityException('Recipe preview snapshot is invalid');
  }
  if (!value.drafts.every(draft => isRecord(draft) && typeof draft.draftId === 'string' && isRecord(draft.recipe) &&
    (draft.image === null || isRecord(draft.image)) && Array.isArray(draft.warnings) && draft.warnings.every(warning => isRecord(warning) && typeof warning.code === 'string' && typeof warning.message === 'string'))) {
    throw new UnprocessableEntityException('Recipe preview snapshot is invalid');
  }
  return value as unknown as RecipePreviewOutputSnapshot;
}

/** Persistence boundary: it deliberately contains only database reads and writes. */
@Injectable()
export class RecipeGenerationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createOrRecoverPreviewRun(input: PreviewRunInput): Promise<{ run: { id: string; status: string; outputSnapshot: unknown }; wasCreated: boolean }> {
    const requestSnapshot = input.requestSnapshot ?? input.criteria ?? {};
    const idempotencyKeyHash = previewHash(input);
    try {
      const run = await this.prisma.generationRun.create({
        data: {
          userId: input.userId, kind: input.kind as never, status: 'PENDING', provider: input.provider ?? 'unavailable', model: input.model ?? 'unavailable',
          promptVersion: input.promptVersion, schemaVersion: input.schemaVersion, requestSnapshot: requestSnapshot as never,
          profileSnapshot: (input.profileSnapshot ?? {}) as never, expiresAt: input.expiresAt ?? undefined, idempotencyKeyHash,
        },
      });
      return { run: run as unknown as { id: string; status: string; outputSnapshot: unknown }, wasCreated: true };
    } catch (error: unknown) {
      if (!isRecord(error) || error.code !== 'P2002') throw error;
      const existing = await this.prisma.generationRun.findFirst({
        where: { userId: input.userId, kind: input.kind as never, idempotencyKeyHash, status: { in: ['PENDING', 'READY_FOR_REVIEW', 'CONFIRMED'] } as never },
      });
      if (!existing) throw error;
      if (canonicalJson(existing.requestSnapshot) !== canonicalJson(requestSnapshot)) {
        throw new ConflictException('Idempotency key was already used with another preview request');
      }
      if (existing.status === 'READY_FOR_REVIEW' && existing.expiresAt && existing.expiresAt <= new Date()) {
        const expired = await this.prisma.generationRun.updateMany({
          where: { id: existing.id, userId: input.userId, status: 'READY_FOR_REVIEW' },
          data: { status: 'EXPIRED', completedAt: new Date() },
        });
        if (expired.count === 1) return this.createOrRecoverPreviewRun(input);
        throw new ConflictException('Recipe preview expiration conflicted');
      }
      return { run: existing as unknown as { id: string; status: string; outputSnapshot: unknown }, wasCreated: false };
    }
  }

  async persistReadyPreview(input: ReadyPreviewInput): Promise<{ generationRunId: string; status: 'READY_FOR_REVIEW'; drafts: RecipeDraft[]; reused: unknown[] }> {
    const snapshot: RecipePreviewOutputSnapshot = {
      version: 1, requestedCount: input.drafts.length + input.reused.length, reused: input.reused, drafts: input.drafts,
      rejected: input.rejected ?? [], confirmation: null,
    };
    const updated = await this.prisma.generationRun.updateMany({
      where: { id: input.runId, userId: input.userId, kind: input.kind as never, status: 'PENDING' },
      data: { status: 'READY_FOR_REVIEW', outputSnapshot: snapshot as never, validationSnapshot: input.validationSnapshot as never, profileSnapshot: input.profileSnapshot as never, expiresAt: input.expiresAt ?? undefined },
    });
    if (updated.count !== 1) {
      const existing = await this.findRunForOwner(input.runId, input.userId);
      if (existing && existing.status === 'READY_FOR_REVIEW') {
        const persisted = parseOutputSnapshot(existing.outputSnapshot);
        return { generationRunId: input.runId, status: 'READY_FOR_REVIEW', drafts: persisted.drafts, reused: persisted.reused };
      }
      throw new ConflictException('Recipe preview can no longer be made ready');
    }
    return { generationRunId: input.runId, status: 'READY_FOR_REVIEW', drafts: input.drafts, reused: input.reused };
  }

  async rejectPreview(input: { runId: string; code: string; userId?: string; rejected?: RejectedCandidate[]; validationSnapshot?: ValidationSummary | JsonRecord }): Promise<void> {
    await this.prisma.generationRun.updateMany({
      where: { id: input.runId, ...(input.userId ? { userId: input.userId } : {}), status: 'PENDING' },
      data: { status: 'REJECTED', errorCode: input.code, validationSnapshot: input.validationSnapshot as never, outputSnapshot: input.rejected ? { version: 1, requestedCount: 0, reused: [], drafts: [], rejected: input.rejected, confirmation: null } as never : undefined, completedAt: new Date() },
    });
  }

  async failPreview(input: { runId: string; userId?: string; code: string }): Promise<void> {
    await this.prisma.generationRun.updateMany({
      where: { id: input.runId, ...(input.userId ? { userId: input.userId } : {}), status: 'PENDING' },
      data: { status: 'FAILED', errorCode: input.code, completedAt: new Date() },
    });
  }

  selectedDrafts(snapshotValue: unknown, draftIds: string[]): RecipeDraft[] {
    if (new Set(draftIds).size !== draftIds.length) throw new UnprocessableEntityException('Draft selections must be unique');
    const snapshot = parseOutputSnapshot(snapshotValue);
    const byId = new Map(snapshot.drafts.map(draft => [draft.draftId, draft]));
    const selected = draftIds.map(id => byId.get(id));
    if (selected.some(draft => !draft)) throw new UnprocessableEntityException('Selected draft is not part of this preview');
    return selected as RecipeDraft[];
  }

  async findRunForOwner(id: string, userId: string) {
    return this.prisma.generationRun.findFirst({ where: { id, userId } });
  }

  async findRunById(id: string) {
    return this.prisma.generationRun.findUnique({ where: { id } });
  }

  async updateRecipeImageTracking(recipeId: string, image: JsonRecord): Promise<void> {
    await this.prisma.recipe.update({ where: { id: recipeId }, data: { image: image as never } });
  }

  async confirmDraftsTransaction(input: ConfirmInput): Promise<ConfirmationResponse & { replayed?: boolean }> {
    if (new Set(input.draftIds).size !== input.draftIds.length) throw new UnprocessableEntityException('Draft selections must be unique');
    const confirmKeyHash = confirmationHash(input);
    const fingerprint = confirmationFingerprint(input);
    try {
      return await this.prisma.$transaction(async tx => {
        const run = await tx.generationRun.findFirst({ where: { id: input.generationRunId, userId: input.userId } });
        if (!run) throw new ConflictException('Recipe generation run is unavailable');
        if (!RECIPE_KINDS.includes(run.kind)) throw new ConflictException('Generation run is not a recipe preview');
        const snapshot = parseOutputSnapshot(run.outputSnapshot);
        if (run.status === 'CONFIRMED') {
          const confirmation = snapshot.confirmation;
          if (confirmation?.idempotencyKeyHash === confirmKeyHash && confirmation.requestFingerprint === fingerprint) return { ...confirmation.response, replayed: true };
          throw new ConflictException('Recipe preview was already confirmed');
        }
        if (run.status !== 'READY_FOR_REVIEW') throw new ConflictException('Recipe preview is not ready for confirmation');
        if (run.expiresAt && run.expiresAt <= new Date()) throw new ConflictException('Recipe preview has expired');
        const selected = input.drafts ?? this.selectedDrafts(run.outputSnapshot, input.draftIds);
        const items: ConfirmationResponse['items'] = [];
        for (const draft of selected as RecipeDraft[]) {
          const recipe = await tx.recipe.create({ data: { ...draft.recipe, image: draft.image as never, origin: 'AI', generationRunId: input.generationRunId } as never });
          items.push({ id: recipe.id, image: (recipe.image as JsonRecord | null) ?? draft.image });
        }
        const response: ConfirmationResponse = { generationRunId: input.generationRunId, items };
        const outputSnapshot: RecipePreviewOutputSnapshot = {
          ...snapshot,
          confirmation: { idempotencyKeyHash: confirmKeyHash, requestFingerprint: fingerprint, selectedDraftIds: [...input.draftIds].sort(), response },
        };
        const updated = await tx.generationRun.updateMany({
          where: { id: input.generationRunId, userId: input.userId, status: 'READY_FOR_REVIEW' },
          data: { status: 'CONFIRMED', completedAt: new Date(), outputSnapshot: outputSnapshot as never },
        });
        if (updated.count !== 1) throw new ConflictException('Recipe preview confirmation conflicted');
        return response;
      });
    } catch (error: unknown) {
      if (!(error instanceof ConflictException)) throw error;
      // A terminal-run conflict is already authoritative. The re-read below is only
      // needed when the conditional READY -> CONFIRMED acquisition lost a race.
      if (!this.prisma.generationRun?.findFirst) throw error;
      const winner = await this.findRunForOwner(input.generationRunId, input.userId);
      if (winner?.status === 'CONFIRMED') {
        const confirmation = parseOutputSnapshot(winner.outputSnapshot).confirmation;
        if (confirmation?.idempotencyKeyHash === confirmKeyHash && confirmation.requestFingerprint === fingerprint) return { ...confirmation.response, replayed: true };
      }
      throw error;
    }
  }
}
