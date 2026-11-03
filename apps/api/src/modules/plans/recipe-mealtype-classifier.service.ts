import { Inject, Injectable, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { MealType } from '@/generated/prisma/client';
import { AiProviderUnavailableError } from '@/modules/openai/openai.service';
import {
  MEALTYPE_CLASSIFICATION_PROMPT_VERSION,
  MEALTYPE_CLASSIFICATION_SCHEMA_VERSION,
  RECIPE_MEALTYPE_CLASSIFICATION_PROVIDER,
  RecipeMealTypeClassificationInput,
  RecipeMealTypeClassificationProvider,
} from './recipe-mealtype-classifier.ports';

const MEAL_TYPES = Object.values(MealType) as MealType[];

@Injectable()
export class RecipeMealTypeClassifierService {
  constructor(
    @Inject(RECIPE_MEALTYPE_CLASSIFICATION_PROVIDER)
    private readonly provider: RecipeMealTypeClassificationProvider,
  ) {}

  async classify(
    recipes: readonly RecipeMealTypeClassificationInput[],
    onModelSelected?: (model: string) => void | Promise<void>,
  ): Promise<MealType[][]> {
    if (recipes.length === 0) return [];

    const safeInput = recipes.map(({ title, ingredients }) => ({ title, ingredients }));
    let raw: string;
    try {
      raw = await this.provider.classify(safeInput, onModelSelected ?? (() => undefined));
    } catch (error) {
      if (error instanceof AiProviderUnavailableError) {
        throw new RecipeMealTypeClassifierUnavailableException(error.reason);
      }
      throw error;
    }

    const parsed = this.parseResponse(raw, recipes.length);
    return parsed.map(types => MEAL_TYPES.filter(type => types.includes(type)));
  }

  private parseResponse(raw: unknown, expectedCount: number): MealType[][] {
    if (typeof raw !== 'string' || raw.trim().length === 0) return this.invalidResponse();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return this.invalidResponse();
    }

    if (!isPlainRecord(parsed) || !hasExactlyKeys(parsed, ['classifications'])) {
      return this.invalidResponse();
    }

    const classifications = parsed.classifications;
    if (!Array.isArray(classifications) || classifications.length !== expectedCount) {
      return this.invalidResponse();
    }

    const normalized: MealType[][] = [];
    for (const value of classifications) {
      if (!Array.isArray(value)) return this.invalidResponse();
      const seen = new Set<string>();
      for (const mealType of value) {
        if (typeof mealType !== 'string' || !MEAL_TYPES.includes(mealType as MealType) || seen.has(mealType)) {
          return this.invalidResponse();
        }
        seen.add(mealType);
      }
      normalized.push(value as MealType[]);
    }
    return normalized;
  }

  private invalidResponse(): never {
    throw new UnprocessableEntityException(
      `The meal type classifier did not pass validation (${MEALTYPE_CLASSIFICATION_SCHEMA_VERSION})`,
    );
  }
}

export class RecipeMealTypeClassifierUnavailableException extends ServiceUnavailableException {
  constructor(readonly reason: AiProviderUnavailableError['reason']) {
    super('The AI provider is not available; retry later');
  }
}

export { MEALTYPE_CLASSIFICATION_PROMPT_VERSION, MEALTYPE_CLASSIFICATION_SCHEMA_VERSION };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every(key => Object.prototype.hasOwnProperty.call(value, key));
}
