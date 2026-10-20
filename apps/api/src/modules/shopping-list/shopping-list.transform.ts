import { createHash } from 'node:crypto';
import { canonicalJson } from '@/utils/idempotency-hash.util';
import {
  ShoppingListItem,
  ShoppingListPlan,
  ShoppingListResponse,
  ShoppingListSource,
  ShoppingListWarning,
} from './shopping-list.types';

const UNIT_ALIASES: Readonly<Record<string, string>> = {
  g: 'g', gramo: 'g', gramos: 'g',
  kg: 'kg', kilogramo: 'kg', kilogramos: 'kg',
  ml: 'ml', mililitro: 'ml', mililitros: 'ml',
  l: 'l', litro: 'l', litros: 'l',
  unidad: 'unidad', unidades: 'unidad',
};

type Decimal = { coefficient: bigint; scale: number };
type Contribution = { source: ShoppingListSource; decimal: Decimal };

function normalizeText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('es');
}

function normalizeUnit(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = normalizeText(value);
  return Object.prototype.hasOwnProperty.call(UNIT_ALIASES, normalized) ? UNIT_ALIASES[normalized] : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function decimalFromNumber(value: number): Decimal {
  const text = value.toString().toLowerCase();
  const [mantissa, exponentText] = text.split('e');
  const exponent = exponentText ? Number(exponentText) : 0;
  const [whole, fraction = ''] = mantissa.split('.');
  let coefficient = BigInt(`${whole}${fraction}`);
  let scale = fraction.length - exponent;

  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }

  return { coefficient, scale };
}

function sumAndRound(contributions: Contribution[]): number {
  const scale = contributions.reduce((maximum, contribution) => Math.max(maximum, contribution.decimal.scale), 0);
  const total = contributions.reduce((sum, contribution) => {
    const { coefficient, scale: contributionScale } = contribution.decimal;
    return sum + coefficient * (10n ** BigInt(scale - contributionScale));
  }, 0n);

  let thousandths: bigint;
  if (scale <= 3) {
    thousandths = total * (10n ** BigInt(3 - scale));
  } else {
    const divisor = 10n ** BigInt(scale - 3);
    const quotient = total / divisor;
    const remainder = total % divisor;
    thousandths = quotient + (remainder * 2n >= divisor ? 1n : 0n);
  }

  const whole = thousandths / 1000n;
  const fractional = (thousandths % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return Number(fractional ? `${whole}.${fractional}` : whole.toString());
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareSources(left: ShoppingListSource, right: ShoppingListSource): number {
  return compareText(left.plannedMealId, right.plannedMealId)
    || compareText(left.recipeId, right.recipeId)
    || left.ingredientIndex - right.ingredientIndex;
}

function compareWarnings(left: ShoppingListWarning, right: ShoppingListWarning): number {
  return compareText(left.plannedMealId, right.plannedMealId)
    || (left.ingredientIndex ?? -1) - (right.ingredientIndex ?? -1)
    || compareText(left.code, right.code);
}

function createItem(planId: string, name: string, unit: string | null, contributions: Contribution[], quantity: number | null): ShoppingListItem {
  const sources = contributions.map(({ source }) => source).sort(compareSources);
  const keyContent = {
    planId,
    name,
    unit,
    sources,
  };

  return {
    key: createHash('sha256').update(canonicalJson(keyContent)).digest('hex'),
    name,
    quantity,
    unit,
    checked: false,
    sources,
  };
}

export function transformShoppingList(weekStart: string, plan: ShoppingListPlan): ShoppingListResponse {
  if (!plan) {
    return {
      weekStart,
      plan: null,
      items: [],
      summary: { totalItems: 0, checkedItems: 0 },
      warnings: [],
    };
  }

  const planId = plan.id;
  const warnings: ShoppingListWarning[] = [];
  const groups = new Map<string, { name: string; unit: string; contributions: Contribution[] }>();
  const isolated: ShoppingListItem[] = [];
  const meals = plan.days.flatMap((day) => day.meals).slice().sort((left, right) => compareText(left.id, right.id));

  for (const meal of meals) {
    const recipe = meal.recipe;
    if (!recipe || !meal.recipeId) {
      warnings.push({ code: 'MISSING_RECIPE', plannedMealId: meal.id });
      continue;
    }

    if (!Array.isArray(recipe.ingredients)) {
      warnings.push({ code: 'INVALID_INGREDIENT', plannedMealId: meal.id });
      continue;
    }

    recipe.ingredients.forEach((value, ingredientIndex) => {
      const ingredient = asRecord(value);
      const normalizedName = typeof ingredient?.name === 'string' ? normalizeText(ingredient.name) : '';
      const rawQuantity = ingredient?.quantity;
      const quantity = typeof rawQuantity === 'number' && Number.isFinite(rawQuantity) && rawQuantity > 0
        ? rawQuantity
        : null;
      const normalizedUnit = normalizeUnit(ingredient?.unit);
      const invalid = !normalizedName || quantity === null || normalizedUnit === null;

      if (invalid) warnings.push({ code: 'INVALID_INGREDIENT', plannedMealId: meal.id, ingredientIndex });
      if (!normalizedName) return;

      const source: ShoppingListSource = {
        plannedMealId: meal.id,
        recipeId: recipe.id,
        ingredientIndex,
        quantity,
        unit: normalizedUnit,
      };

      if (invalid) {
        isolated.push(createItem(planId, normalizedName, normalizedUnit, [{ source, decimal: quantity === null ? { coefficient: 0n, scale: 0 } : decimalFromNumber(quantity) }], quantity));
        return;
      }

      const groupKey = canonicalJson([normalizedName, normalizedUnit]);
      const group = groups.get(groupKey) ?? { name: normalizedName, unit: normalizedUnit, contributions: [] };
      group.contributions.push({ source, decimal: decimalFromNumber(quantity) });
      groups.set(groupKey, group);
    });
  }

  const items = [
    ...[...groups.values()].map((group) => createItem(
      planId,
      group.name,
      group.unit,
      group.contributions,
      sumAndRound(group.contributions),
    )),
    ...isolated,
  ].sort((left, right) => compareText(left.name, right.name)
    || compareText(left.unit ?? '', right.unit ?? '')
    || compareText(left.key, right.key));

  warnings.sort(compareWarnings);

  return {
    weekStart,
    plan: {
      id: plan.id,
      version: plan.version,
      updatedAt: new Date(plan.updatedAt).toISOString(),
    },
    items,
    summary: { totalItems: items.length, checkedItems: 0 },
    warnings,
  };
}
