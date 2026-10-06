import { Recipe, RecipeCategory } from '@/generated/prisma/client';

export interface RecipeCoverageRequest {
  userId: string;
  topic?: string;
  desiredTotal: number;
  categories?: RecipeCategory[];
  properties?: string[];
  maxPrepMinutes?: number;
  excludeRecipeIds?: string[];
}

export interface RecipeCoverageCriteria {
  topic?: string;
  categories: RecipeCategory[];
  properties: string[];
  maxPrepMinutes?: number;
  excludeRecipeIds: string[];
  requiredCategoryGroups: RecipeCategory[][];
  desiredTotal: number;
}

/** Internal projection returned by the single bounded coverage query. */
export interface RecipeCoverageCandidate extends Recipe {
  score: number;
  topic: boolean;
}

export interface RecipeCoverageResult {
  compatibleRecipes: Array<{ recipe: Recipe; matchReasons: string[]; score: number }>;
  desiredTotal: number;
  compatibleCount: number;
  missingCount: number;
  normalizedCriteria: Pick<RecipeCoverageCriteria, 'topic' | 'categories' | 'properties' | 'maxPrepMinutes'>;
}

export interface PotentialDuplicateWarning {
  kind: 'potential-duplicate';
  fingerprint: string;
  recipeIds: string[];
}

export interface RecipeCoverageEvaluation {
  result: RecipeCoverageResult;
  warnings: PotentialDuplicateWarning[];
}

/** A recoverable domain failure: recipe metadata cannot safely enforce this profile. */
export class InsufficientCoverageProfileError extends Error {
  constructor(message = 'Nutrition profile cannot be safely evaluated for recipe coverage') {
    super(message);
    this.name = 'InsufficientCoverageProfileError';
  }
}
