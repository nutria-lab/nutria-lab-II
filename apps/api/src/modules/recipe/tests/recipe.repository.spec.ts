import { RecipeRepository } from '../recipe.repository';

type RawQuery = {
  sql: string;
  values: unknown[];
};

describe('RecipeRepository.findAll', () => {
  const queryRaw = jest.fn();
  const repository = new RecipeRepository({ $queryRaw: queryRaw } as never);

  beforeEach(() => {
    jest.clearAllMocks();
    queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: BigInt(0) }]);
  });

  it('builds one parameterized predicate for items and total, including literal text search, properties AND, and preparation limit', async () => {
    await repository.findAll({
      q: "Café 100%_\\' OR 1=1 --",
      properties: ['Sin Gluten', 'Alto en Fibra'],
      maxPrepMinutes: 30,
      page: 2,
      pageSize: 8,
    });

    expect(queryRaw).toHaveBeenCalledTimes(2);

    const [itemsCall, countCall] = queryRaw.mock.calls;
    const itemsTemplate = itemsCall[0] as TemplateStringsArray;
    const countTemplate = countCall[0] as TemplateStringsArray;
    const itemsWhere = itemsCall[1] as RawQuery;
    const countWhere = countCall[1] as RawQuery;
    const expectedPattern = "%Café 100\\%\\_\\\\' OR 1=1 --%";

    expect(itemsWhere).toBe(countWhere);
    expect(itemsWhere.sql).toContain('unaccent(lower("title")) LIKE unaccent(lower(?))');
    expect(itemsWhere.sql).toContain('OR unaccent(lower("description")) LIKE unaccent(lower(?))');
    expect(itemsWhere.sql).toContain("ESCAPE E'\\\\'");
    expect(itemsWhere.sql.match(/EXISTS \(/g)).toHaveLength(2);
    expect(itemsWhere.sql).toContain('WHERE lower(recipe_property) = lower(?)');
    expect(itemsWhere.sql).toContain('"prepMinutes" <= ?');
    expect(itemsWhere.values).toEqual([
      expectedPattern,
      expectedPattern,
      'Sin Gluten',
      'Alto en Fibra',
      30,
    ]);
    expect(itemsWhere.sql).not.toContain("Café 100%_\\' OR 1=1 --");
    expect(itemsTemplate.join('')).toContain('ORDER BY "createdAt" DESC, "id" DESC');
    expect(itemsTemplate.join('')).toContain('OFFSET');
    expect(itemsTemplate.join('')).toContain('LIMIT');
    expect(itemsCall.slice(2)).toEqual([8, 8]);
    expect(countTemplate.join('')).toContain('SELECT COUNT(*) AS "total"');
  });
});
