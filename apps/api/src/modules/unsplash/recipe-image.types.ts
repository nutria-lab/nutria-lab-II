// Persisted shape of a resolved recipe image (design.md section 8). Provider-agnostic on
// purpose except for the `provider` literal — same type survived the Pexels -> Unsplash swap
// unchanged (design.md 11.2).
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

// Private metadata (design.md 12.5.1) - lives only inside the persisted `Recipe.image` column,
// never in a public DTO. Nested under its own key so a careless `...image` spread still carries
// it along visibly, instead of looking like just another public field.
export type UnsplashTrackingMetadata = {
  trackingUrl: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  lastAttemptAt: string | null;
};

// Real shape of the persisted `Recipe.image` JSONB column: the public contract plus the private
// tracking metadata. A DTO must only ever expose `RecipeImage` (via `toPublicRecipeImage`),
// never this type directly.
export type PersistedRecipeImage = RecipeImage & { tracking: UnsplashTrackingMetadata };
