export const RECIPE_GENERATION_PROVIDER = Symbol('RECIPE_GENERATION_PROVIDER');

export interface RecipeGenerationProvider {
  generate(input: { profile: unknown; criteria: unknown; count: number; promptVersion: string; schemaVersion: string }): Promise<string>;
}

/** Provider-neutral safe default until a concrete adapter is configured. */
export class UnavailableRecipeGenerationProvider implements RecipeGenerationProvider {
  async generate(): Promise<never> {
    throw Object.assign(new Error('Recipe generation provider is not integrated'), { status: 503 });
  }
}
