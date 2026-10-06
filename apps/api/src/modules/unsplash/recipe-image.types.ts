// Imagen pública: es lo único que ve el cliente en recipe.image.
export type RecipeImage = {
  provider: 'UNSPLASH';
  providerPhotoId: string;
  imageUrl: string;
  sourceUrl: string;
  photographer: string;
  photographerUrl: string;
  alt: string;
  query: string;
  retrievedAt: string;
};

// Metadata privada del registro de uso en Unsplash. Se guarda dentro de Recipe.image pero nunca
// sale en una respuesta (toPublicRecipeImage la quita).
export type UnsplashTrackingMetadata = {
  trackingUrl: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  lastAttemptAt: string | null;
};

// Lo que realmente se guarda en la columna Recipe.image.
export type PersistedRecipeImage = RecipeImage & { tracking: UnsplashTrackingMetadata };
