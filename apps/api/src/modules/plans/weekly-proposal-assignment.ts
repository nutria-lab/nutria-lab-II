import { DayOfWeek, MealType } from '../../generated/prisma/client';

export interface WeeklyMealSlot {
  key: string;
  date: string;
  day: DayOfWeek;
  mealType: MealType;
}

const DAY_ORDER = [
  DayOfWeek.SUNDAY,
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
  DayOfWeek.SATURDAY,
];

const MEAL_ORDER = [MealType.BREAKFAST, MealType.LUNCH, MealType.SNACK, MealType.DINNER];
const DAY_MS = 24 * 60 * 60 * 1000;

export function buildWeeklySlots(weekStart: Date): WeeklyMealSlot[] {
  const start = new Date(weekStart);

  return Array.from({ length: 7 }, (_, dayOffset) => {
    const date = new Date(start.getTime() + dayOffset * DAY_MS).toISOString().slice(0, 10);
    const day = DAY_ORDER[new Date(start.getTime() + dayOffset * DAY_MS).getUTCDay()];
    return MEAL_ORDER.map(mealType => ({
      key: `${date}:${mealType}`,
      date,
      day,
      mealType,
    }));
  }).flat();
}

/** Stable, maximum-cardinality matching with capacity one for each candidate ID. */
export function matchRecipesToSlots<T extends { id: string }>(
  slots: readonly { key: string }[],
  candidates: readonly T[],
  isEligible: (slot: { key: string }, candidate: T) => boolean,
): Map<string, T> {
  const uniqueCandidates = [...new Map(candidates.map(candidate => [candidate.id, candidate])).values()];
  const candidateToSlot = new Map<string, string>();

  const assign = (slot: { key: string }, visited: Set<string>): boolean => {
    for (const candidate of uniqueCandidates) {
      if (visited.has(candidate.id) || !isEligible(slot, candidate)) continue;
      visited.add(candidate.id);

      const previousSlotKey = candidateToSlot.get(candidate.id);
      if (!previousSlotKey) {
        candidateToSlot.set(candidate.id, slot.key);
        return true;
      }

      const previousSlot = slots.find(item => item.key === previousSlotKey);
      if (previousSlot && assign(previousSlot, visited)) {
        candidateToSlot.set(candidate.id, slot.key);
        return true;
      }
    }
    return false;
  };

  for (const slot of slots) assign(slot, new Set());

  const candidatesById = new Map(uniqueCandidates.map(candidate => [candidate.id, candidate]));
  const assignments = new Map<string, T>();
  for (const [candidateId, slotKey] of candidateToSlot) {
    const candidate = candidatesById.get(candidateId);
    if (candidate) assignments.set(slotKey, candidate);
  }
  return assignments;
}

export function chunkHomogeneous<T>(
  items: readonly T[],
  keyOf: (item: T) => unknown,
  maxSize = 10,
): T[][] {
  if (!Number.isInteger(maxSize) || maxSize < 1) throw new RangeError('maxSize must be a positive integer');

  const chunks: T[][] = [];
  let current: T[] = [];
  let currentKey: unknown;

  for (const item of items) {
    const key = keyOf(item);
    if (current.length > 0 && (key !== currentKey || current.length >= maxSize)) {
      chunks.push(current);
      current = [];
    }
    if (current.length === 0) currentKey = key;
    current.push(item);
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}
