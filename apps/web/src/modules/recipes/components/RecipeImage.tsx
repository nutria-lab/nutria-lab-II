import { useState } from 'react';
import type { RecipeImage as RecipeImageData } from '../../../services/recipeService';

type Props = { image?: RecipeImageData | null; title: string; className?: string; compact?: boolean };

export function RecipeImage({ image, title, className = '', compact = false }: Props) {
  const [failed, setFailed] = useState(false);
  const visible = Boolean(image?.imageUrl && image.alt && !failed);
  return <div className={`relative overflow-hidden bg-surface-container ${className}`}>
    {visible ? <>
      <img src={image!.imageUrl} alt={image!.alt} onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
    </> : <div className="absolute inset-0 flex items-center justify-center" aria-label={`Imagen no disponible para ${title}`}>
    </div>}
  </div>;
}
