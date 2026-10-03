/**
 * Forma persistida del resultado de resolución de imagen de Pexels para una receta
 * (design.md sección 8 / sección 3 del DTO tipado). Vive en su propio archivo para que
 * `pexels-candidate-selector.util.ts`, `pexels.service.ts` y, en una etapa posterior,
 * `plans.repository.ts` puedan importarlo sin traer el servicio completo.
 */
export type RecipeImage = {
  provider: 'PEXELS';
  providerPhotoId: string;
  imageUrl: string;
  sourceUrl: string;
  photographer: string;
  photographerUrl: string;
  alt: string;
  query: string;
  retrievedAt: string;
};
