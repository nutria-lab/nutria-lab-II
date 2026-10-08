import { Injectable } from '@nestjs/common';
import {
  Diet,
  DietaryRestriction,
  CookTimePreference,
  NutritionProfile,
  NutritionGoal,
  Recipe,
  RecipeCategory,
} from '@/generated/prisma/client';
import { NutritionProfileRepository } from '@/modules/nutrition-profile/nutrition-profile.repository';
import { normalizeProperties } from '@/utils/normalize-properties.util';
import { normalizeRecipeText, recipeFingerprint } from './recipe-fingerprint.util';
import { RecipeRepository } from './recipe.repository';
import {
  InsufficientCoverageProfileError,
  PotentialDuplicateWarning,
  RecipeCoverageCriteria,
  RecipeCoverageCandidate,
  RecipeCoverageEvaluation,
  RecipeCoverageRequest,
} from './recipe-coverage.types';

const recipeCategories = new Set(Object.values(RecipeCategory));

@Injectable()
export class RecipeCoverageService {
  constructor(
    private readonly recipes: RecipeRepository,
    private readonly profiles: NutritionProfileRepository,
  ) {}

  async evaluate(request: RecipeCoverageRequest): Promise<RecipeCoverageEvaluation> {
    const criteria = this.normalizeRequest(request);
    const profile = await this.profiles.findByUserId(request.userId);
    const requiredCategoryGroups = this.profileCategoryGroups(profile);
    const candidates = await this.recipes.findCoverageCandidates({ ...criteria, requiredCategoryGroups });

    const unique = new Map<string, RecipeCoverageCandidate>();
    for (const candidate of candidates) {
      if (!unique.has(candidate.id)) unique.set(candidate.id, candidate);
    }

    const selected = [...unique.values()]
      .sort((left, right) => this.compareRecipes(left, right, criteria))
      .slice(0, criteria.desiredTotal);
    const compatibleRecipes = selected.map(recipe => ({
      recipe,
      score: this.score(recipe, criteria),
      matchReasons: this.matchReasons(recipe, criteria),
    }));
    const compatibleCount = compatibleRecipes.length;

    return {
      result: {
        compatibleRecipes,
        desiredTotal: criteria.desiredTotal,
        compatibleCount,
        missingCount: Math.max(0, criteria.desiredTotal - compatibleCount),
        normalizedCriteria: {
          topic: criteria.topic,
          categories: criteria.categories,
          properties: criteria.properties,
          maxPrepMinutes: criteria.maxPrepMinutes,
        },
      },
      warnings: this.potentialDuplicateWarnings(selected),
    };
  }

  // NUT-73 only uses this bounded catalog view to avoid generated duplicates; it never
  // uses the entries as preview fill-ins for NEW_ONLY requests.
  async findCompatibilityFingerprints(request: RecipeCoverageRequest): Promise<string[]> {
    const evaluation = await this.evaluate({ ...request, desiredTotal: 10 });
    return evaluation.result.compatibleRecipes.map(({ recipe }) => recipeFingerprint(recipe));
  }

  private normalizeRequest(request: RecipeCoverageRequest): Omit<RecipeCoverageCriteria, 'requiredCategoryGroups'> {
    if (!Number.isInteger(request.desiredTotal) || request.desiredTotal < 1 || request.desiredTotal > 10) {
      throw new RangeError('desiredTotal must be an integer between 1 and 10');
    }
    if (request.maxPrepMinutes !== undefined &&
      (!Number.isInteger(request.maxPrepMinutes) || request.maxPrepMinutes <= 0)) {
      throw new RangeError('maxPrepMinutes must be a positive integer');
    }
    const categories = this.uniqueCategories(request.categories ?? []);
    const topic = typeof request.topic === 'string' ? request.topic.trim() || undefined : undefined;
    return {
      topic,
      categories,
      properties: normalizeProperties(request.properties ?? []),
      maxPrepMinutes: request.maxPrepMinutes,
      excludeRecipeIds: [...new Set((request.excludeRecipeIds ?? []).filter((id): id is string => typeof id === 'string'))],
      desiredTotal: request.desiredTotal,
    };
  }

  private uniqueCategories(categories: RecipeCategory[]): RecipeCategory[] {
    const unique: RecipeCategory[] = [];
    for (const category of categories) {
      if (!recipeCategories.has(category)) throw new RangeError('Invalid recipe category');
      if (!unique.includes(category)) unique.push(category);
    }
    return unique;
  }

  private profileCategoryGroups(profile: NutritionProfile | null): RecipeCategory[][] {
    if (!profile ||
      !Object.values(Diet).includes(profile.diet) ||
      !Object.values(NutritionGoal).includes(profile.goal) ||
      !Object.values(CookTimePreference).includes(profile.cookTimePreference) ||
      !Array.isArray(profile.excludedIngredients)) {
      throw new InsufficientCoverageProfileError();
    }
    const groups: RecipeCategory[][] = [];
    if (profile.diet === Diet.VEGAN) groups.push([RecipeCategory.VEGAN]);
    else if (profile.diet === Diet.VEGETARIAN) groups.push([RecipeCategory.VEGETARIAN, RecipeCategory.VEGAN]);
    else if (profile.diet !== Diet.ALL) throw new InsufficientCoverageProfileError();

    for (const restriction of profile.excludedIngredients) {
      if (restriction === DietaryRestriction.GLUTEN) groups.push([RecipeCategory.GLUTEN_FREE]);
      else if (restriction === DietaryRestriction.DAIRY) groups.push([RecipeCategory.DAIRY_FREE]);
      else throw new InsufficientCoverageProfileError();
    }
    return groups;
  }

  private score(recipe: Recipe, criteria: Omit<RecipeCoverageCriteria, 'requiredCategoryGroups'>): number {
    const categories = new Set(recipe.categories);
    const properties = new Set(recipe.properties.map(property => property.toLowerCase()));
    return criteria.categories.filter(category => categories.has(category)).length +
      criteria.properties.filter(property => properties.has(property.toLowerCase())).length;
  }

  private compareRecipes(left: RecipeCoverageCandidate, right: RecipeCoverageCandidate, criteria: Omit<RecipeCoverageCriteria, 'requiredCategoryGroups'>): number {
    const scoreDifference = this.score(right, criteria) - this.score(left, criteria);
    if (scoreDifference) return scoreDifference;
    const topicDifference = Number(this.topicMatches(right, criteria.topic)) - Number(this.topicMatches(left, criteria.topic));
    if (topicDifference) return topicDifference;
    if (left.prepMinutes !== right.prepMinutes) return left.prepMinutes - right.prepMinutes;
    return left.id.localeCompare(right.id);
  }

  private matchReasons(recipe: RecipeCoverageCandidate, criteria: Omit<RecipeCoverageCriteria, 'requiredCategoryGroups'>): string[] {
    const reasons = criteria.categories
      .filter(category => recipe.categories.includes(category))
      .map(category => `category:${category}`);
    const properties = new Set(recipe.properties.map(property => property.toLowerCase()));
    reasons.push(...criteria.properties
      .filter(property => properties.has(property.toLowerCase()))
      .map(property => `property:${property}`));
    if (recipe.topic === true) {
      reasons.push('topic:catalog');
    } else if (criteria.topic) {
      const topic = normalizeRecipeText(criteria.topic);
      if (normalizeRecipeText(recipe.title).includes(topic)) reasons.push('topic:title');
      else if (normalizeRecipeText(recipe.description).includes(topic)) reasons.push('topic:description');
    }
    if (criteria.maxPrepMinutes !== undefined) reasons.push(`prep-minutes:${recipe.prepMinutes}`);
    return reasons;
  }

  private topicMatches(recipe: RecipeCoverageCandidate, topic?: string): boolean {
    if (!topic) return false;
    // The bounded SQL query is authoritative whenever its projection is present.
    // The fallback only supports direct unit callers that provide a plain Recipe.
    if (typeof recipe.topic === 'boolean') return recipe.topic;
    const normalizedTopic = normalizeRecipeText(topic);
    return normalizeRecipeText(recipe.title).includes(normalizedTopic) ||
      normalizeRecipeText(recipe.description).includes(normalizedTopic);
  }

  private potentialDuplicateWarnings(recipes: Recipe[]): PotentialDuplicateWarning[] {
    const groups = new Map<string, string[]>();
    for (const recipe of recipes) {
      const fingerprint = recipeFingerprint(recipe);
      groups.set(fingerprint, [...(groups.get(fingerprint) ?? []), recipe.id]);
    }
    return [...groups.entries()]
      .filter(([, ids]) => new Set(ids).size > 1)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([fingerprint, recipeIds]) => ({
        kind: 'potential-duplicate' as const,
        fingerprint,
        recipeIds: [...new Set(recipeIds)].sort(),
      }));
  }
}
