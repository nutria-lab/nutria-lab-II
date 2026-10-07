import { Injectable, Logger } from '@nestjs/common';
import { UnsplashService, resolveWithBoundedConcurrency } from '@/modules/unsplash/unsplash.service';
import type { PersistedRecipeImage } from '@/modules/unsplash/recipe-image.types';
import { MealPlanDayDto } from './dto';
import { PlansRepository, type RecipeForTracking } from './plans.repository';

// Fotos de las recetas de un plan (NUT-83): se buscan antes de la transacción y su uso se registra
// después del commit. Lo usan la generación, la edición y la regeneración del plan (NUT-78).
@Injectable()
export class RecipeImagesService {
  private readonly logger = new Logger(RecipeImagesService.name);

  constructor(
    private readonly repository: PlansRepository,
    private readonly unsplash: UnsplashService,
  ) {}

  // Busca las imágenes del plan. Si algo falla de forma inesperada, el plan se guarda sin imágenes.
  async resolveImagesOrDegrade(days: MealPlanDayDto[]): Promise<MealPlanDayDto[]> {
    try {
      return await this.unsplash.searchAndSelectImages(days);
    } catch (error: any) {
      this.logger.error(
        `Image search failed unexpectedly (bug, not a routine provider failure); continuing without resolved images: ${error?.message ?? 'unknown error'}`,
        error?.stack
      );
      return days;
    }
  }

  // Después de guardar el plan: registra el uso de cada foto nueva (un evento por foto, de a 3 en
  // paralelo) y guarda el resultado en cada receta.
  async trackNewRecipeImages(recipesForTracking: RecipeForTracking[]): Promise<void> {
    const recipesByTrackingUrl = new Map<string, RecipeForTracking[]>();
    for (const item of recipesForTracking) {
      const group = recipesByTrackingUrl.get(item.image.tracking.trackingUrl) ?? [];
      group.push(item);
      recipesByTrackingUrl.set(item.image.tracking.trackingUrl, group);
    }

    await resolveWithBoundedConcurrency(Array.from(recipesByTrackingUrl.values()), async (group) => {
      // El repositorio no conoce el tipo de Unsplash (ver plans-transaction-no-network.spec.ts).
      const { tracking } = await this.unsplash.trackDownload(group[0].image as unknown as PersistedRecipeImage);
      for (const item of group) {
        await this.repository.updateRecipeImageTracking(item.recipeId, { ...item.image, tracking });
      }
    });
  }
}
