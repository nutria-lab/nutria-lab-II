import type { CookTimePreference } from '../../services/nutritionProfileService';

// Fuente única y ordenada del slider móvil, sus marcas y las tarjetas de desktop: la posición del slider es el índice.
export const COOK_TIME_OPTIONS: {
  value: CookTimePreference;
  title: string;
  valueLabel: string;
  description: string;
  minutes: number;
  markAlignment: string;
}[] = [
  { value: 'QUICK', title: 'Rápido', valueLabel: '15m', description: 'Comidas rápidas y saludables para días ocupados.', minutes: 15, markAlignment: 'text-left' },
  { value: 'STANDARD', title: 'Estándar', valueLabel: '30m', description: 'El equilibrio perfecto entre facilidad y sabor.', minutes: 30, markAlignment: 'text-center' },
  { value: 'GOURMET', title: 'Gourmet', valueLabel: '60m', description: 'Sabores elaborados para quienes disfrutan cocinar.', minutes: 60, markAlignment: 'text-right' },
];

export function isCookTimePreference(value: unknown): value is CookTimePreference {
  return COOK_TIME_OPTIONS.some((option) => option.value === value);
}
