import type { Ingredient, MealPlanDay, MealType } from '../../services/mealPlanService';

const DAY_ABBREVIATIONS = ['DOM', 'LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB'];

const WEEKDAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

export const MEAL_TYPE_LABELS: Record<MealType, string> = {
  BREAKFAST: 'Desayuno',
  LUNCH: 'Almuerzo',
  SNACK: 'Merienda',
  DINNER: 'Cena',
};

// Evita el corrimiento de día que da new Date('YYYY-MM-DD') (lo interpreta como UTC).
// El backend real puede devolver `date` como datetime ISO completo
// (ej. '2026-09-14T00:00:00.000Z') en vez de 'YYYY-MM-DD'; nos quedamos solo con la
// porción de fecha antes de parsear los componentes locales.
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day);
}

// Inversa de parseLocalDate: arma YYYY-MM-DD a partir de los componentes LOCALES
// de la fecha, sin pasar por toISOString() (que convierte a UTC y puede correr el día).
export function formatLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isValidDate(date: Date): boolean {
  return !Number.isNaN(date.getTime());
}

export function formatDayAbbreviation(dateStr: string): string {
  const date = parseLocalDate(dateStr);
  if (!isValidDate(date)) {
    return '';
  }
  return DAY_ABBREVIATIONS[date.getDay()];
}

export function formatDayNumber(dateStr: string): string {
  const date = parseLocalDate(dateStr);
  if (!isValidDate(date)) {
    return '';
  }
  return String(date.getDate());
}

export function formatFullDate(dateStr: string): string {
  const date = parseLocalDate(dateStr);
  if (!isValidDate(date)) {
    return '';
  }
  const weekday = WEEKDAY_NAMES[date.getDay()];
  const capitalizedWeekday = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return `${capitalizedWeekday}, ${date.getDate()} de ${MONTH_NAMES[date.getMonth()]}`;
}

export function formatWeekRange(days: MealPlanDay[]): string {
  if (days.length === 0) {
    return '';
  }
  const first = parseLocalDate(days[0].date);
  const last = parseLocalDate(days[days.length - 1].date);
  if (!isValidDate(first) || !isValidDate(last)) {
    return '';
  }
  const sameMonth = first.getMonth() === last.getMonth();
  const startLabel = sameMonth
    ? `${first.getDate()}`
    : `${first.getDate()} de ${MONTH_NAMES[first.getMonth()]}`;
  return `${startLabel} – ${last.getDate()} de ${MONTH_NAMES[last.getMonth()]}, ${last.getFullYear()}`;
}

export function formatIngredient(ingredient: Ingredient): string {
  const parts: string[] = [];
  if (ingredient.quantity != null) {
    parts.push(String(ingredient.quantity));
  }
  if (ingredient.unit) {
    parts.push(ingredient.unit);
  }
  parts.push(ingredient.name);
  return parts.join(' ');
}
