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

// Evita el corrimiento de día que da `new Date('YYYY-MM-DD')` (lo interpreta como UTC).
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function formatDayAbbreviation(dateStr: string): string {
  return DAY_ABBREVIATIONS[parseLocalDate(dateStr).getDay()];
}

export function formatDayNumber(dateStr: string): string {
  return String(parseLocalDate(dateStr).getDate());
}

export function formatFullDate(dateStr: string): string {
  const date = parseLocalDate(dateStr);
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
