import { MealType } from '../generated/prisma/client';
import { compareMealsByDomainOrder } from './meal-plan-order.util';

type Meal = { id: string; mealType: string };

function meal(mealType: string, id: string): Meal {
  return { id, mealType };
}

describe('compareMealsByDomainOrder', () => {
  it('orders every generated MealType as breakfast, lunch, snack, then dinner', () => {
    const meals = Object.values(MealType).map((mealType) => meal(mealType, `id-${mealType}`));
    const sortedMealTypes = [...meals].sort(compareMealsByDomainOrder).map(({ mealType }) => mealType);

    expect(sortedMealTypes).toEqual([
      MealType.BREAKFAST,
      MealType.LUNCH,
      MealType.SNACK,
      MealType.DINNER,
    ]);
  });

  it('returns finite, antisymmetric, transitive comparisons for known and unknown meal types', () => {
    const meals = [
      meal(MealType.BREAKFAST, 'z-breakfast'),
      meal(MealType.LUNCH, 'lunch'),
      meal(MealType.SNACK, 'snack'),
      meal(MealType.DINNER, 'a-dinner'),
      meal('BRUNCH', 'b-brunch'),
      meal('ZEBRA', 'x-zebra'),
    ];

    for (const left of meals) {
      for (const right of meals) {
        const forward = compareMealsByDomainOrder(left, right);
        const reverse = compareMealsByDomainOrder(right, left);

        expect(Number.isFinite(forward)).toBe(true);
        expect(Math.sign(forward) + Math.sign(reverse)).toBe(0);
      }
    }

    for (const first of meals) {
      for (const second of meals) {
        for (const third of meals) {
          const firstToSecond = compareMealsByDomainOrder(first, second);
          const secondToThird = compareMealsByDomainOrder(second, third);
          const firstToThird = compareMealsByDomainOrder(first, third);

          if (firstToSecond <= 0 && secondToThird <= 0) {
            expect(firstToThird).toBeLessThanOrEqual(0);
          }
        }
      }
    }
  });

  it('places prototype-key unknown types after known types with finite comparisons', () => {
    const breakfast = meal(MealType.BREAKFAST, 'z-breakfast');
    const prototypeKeyMeals = ['toString', 'constructor', '__proto__'].map((mealType, index) =>
      meal(mealType, `a-prototype-key-${index}`),
    );

    for (const unknown of prototypeKeyMeals) {
      const comparison = compareMealsByDomainOrder(breakfast, unknown);

      expect(Number.isFinite(comparison)).toBe(true);
      expect(comparison).toBeLessThan(0);
    }
  });

  it('sorts all six dinner, unknown, and breakfast permutations into the same order', () => {
    const dinner = meal(MealType.DINNER, 'a-dinner');
    const unknown = meal('MYSTERY', 'b-unknown');
    const breakfast = meal(MealType.BREAKFAST, 'z-breakfast');
    const permutations = [
      [dinner, unknown, breakfast],
      [dinner, breakfast, unknown],
      [unknown, dinner, breakfast],
      [unknown, breakfast, dinner],
      [breakfast, dinner, unknown],
      [breakfast, unknown, dinner],
    ];

    const sortedOrders = permutations.map((items) =>
      [...items].sort(compareMealsByDomainOrder).map(({ mealType }) => mealType),
    );

    expect(sortedOrders).toEqual(
      Array.from({ length: permutations.length }, () => [
        MealType.BREAKFAST,
        MealType.DINNER,
        'MYSTERY',
      ]),
    );
  });

  it('orders distinct unknown meal types lexically before using IDs', () => {
    const zebra = meal('ZEBRA', 'a-zebra');
    const brunch = meal('BRUNCH', 'z-brunch');

    expect(compareMealsByDomainOrder(brunch, zebra)).toBeLessThan(0);
    expect([zebra, brunch].sort(compareMealsByDomainOrder)).toEqual([brunch, zebra]);
  });

  it('uses ID as the final tie-break when meal types are equal', () => {
    const later = meal(MealType.LUNCH, 'meal-2');
    const earlier = meal(MealType.LUNCH, 'meal-1');

    expect(compareMealsByDomainOrder(earlier, later)).toBeLessThan(0);
    expect([later, earlier].sort(compareMealsByDomainOrder)).toEqual([earlier, later]);
  });
});
