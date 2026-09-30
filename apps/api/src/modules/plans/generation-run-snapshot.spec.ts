import { buildProfileSnapshot } from './generation-run-snapshot';

describe('buildProfileSnapshot', () => {
  const mockProfile = {
    id: 'profile-1',
    userId: 'user-1',
    goal: 'LOSE_WEIGHT',
    diet: 'VEGAN',
    excludedIngredients: ['NUTS', 'GLUTEN'],
    cookTimePreference: 'QUICK',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-02-01T00:00:00.000Z')
  };

  it('should only include the whitelisted fields, excluding id/userId/createdAt/updatedAt', () => {
    const result = buildProfileSnapshot(mockProfile);

    expect(Object.keys(result)).toEqual(['goal', 'diet', 'excludedIngredients', 'cookTimePreference']);
  });

  it('should preserve whitelisted values as-is, without transforming them', () => {
    const result = buildProfileSnapshot(mockProfile);

    expect(result.goal).toBe('LOSE_WEIGHT');
    expect(result.diet).toBe('VEGAN');
    expect(result.excludedIngredients).toEqual(['NUTS', 'GLUTEN']);
    expect(result.cookTimePreference).toBe('QUICK');
  });
});
