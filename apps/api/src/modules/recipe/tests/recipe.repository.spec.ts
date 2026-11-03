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

  it('includes the "image" column in the raw SELECT for items (NUT-83 AC10)', async () => {
    await repository.findAll({
      page: 1,
      pageSize: 10,
    });

    const [itemsCall] = queryRaw.mock.calls;
    const itemsTemplate = itemsCall[0] as TemplateStringsArray;

    expect(itemsTemplate.join('')).toMatch(/"image"/);
  });

  it('uses the same property-predicate builder as coverage so NUT-69 property semantics cannot drift', async () => {
    const propertyPredicate = jest.spyOn(repository as never, 'propertyPredicate' as never);

    await repository.findAll({
      properties: ['Sin Gluten', 'Alto en Fibra'],
      page: 1,
      pageSize: 12,
    });

    expect(propertyPredicate).toHaveBeenCalledTimes(2);
    expect(propertyPredicate).toHaveBeenNthCalledWith(1, 'Sin Gluten');
    expect(propertyPredicate).toHaveBeenNthCalledWith(2, 'Alto en Fibra');
  });
});

describe('RecipeRepository.findCoverageCandidates', () => {
  const queryRaw = jest.fn();
  const repository = new RecipeRepository({ $queryRaw: queryRaw } as never);

  beforeEach(() => {
    jest.clearAllMocks();
    queryRaw.mockResolvedValue([]);
  });

  it('uses one bounded, parameterized query with hard coverage gates and the deterministic coverage order', async () => {
    await repository.findCoverageCandidates({
      topic: "Café 100%_\\' OR 1=1 --",
      categories: ['VEGAN', 'HIGH_PROTEIN'],
      requiredCategoryGroups: [['VEGAN'], ['GLUTEN_FREE']],
      properties: ['Sin Gluten', 'Alto en Fibra'],
      maxPrepMinutes: 30,
      excludeRecipeIds: ['used-1', 'used-2'],
      desiredTotal: 3,
    });

    expect(queryRaw).toHaveBeenCalledTimes(1);

    const call = queryRaw.mock.calls[0];
    const template = call[0] as TemplateStringsArray;
    const where = call[1] as RawQuery;
    const sql = `${template.join(' ')} ${where.sql}`;
    const expectedPattern = "%Café 100\\%\\_\\\\' OR 1=1 --%";

    expect(sql).toContain('"ingredients"');
    expect(sql).toContain('"origin"');
    expect(sql).toContain('"generationRunId"');
    expect(sql).toContain('unaccent(lower("title")) LIKE unaccent(lower(?))');
    expect(sql).toContain('unaccent(lower("description")) LIKE unaccent(lower(?))');
    expect(sql).toContain("ESCAPE E'\\\\'");
    expect(sql).toContain('WHERE lower(recipe_property) = lower(?)');
    expect(sql).toContain('"prepMinutes" <= ?');
    expect(sql).toContain('"id" NOT IN');
    expect(sql).toContain('ORDER BY');
    expect(sql).toMatch(/score\s+DESC/i);
    expect(sql).toMatch(/topic.*DESC/i);
    expect(sql).toMatch(/"prepMinutes"\s+ASC/i);
    expect(sql).toMatch(/"id"\s+ASC/i);
    expect(sql).toContain('LIMIT');
    expect(sql).not.toContain('OFFSET');
    expect(sql).not.toContain('COUNT(');
    expect(sql).not.toContain("Café 100%_\\' OR 1=1 --");
    expect(where.values).toEqual(expect.arrayContaining([
      expectedPattern,
      'Sin Gluten',
      'Alto en Fibra',
      30,
      'VEGAN',
      'GLUTEN_FREE',
      'used-1',
      'used-2',
    ]));
    expect(call).toContain(3);
  });
});

describe('RecipeRepository.findMealTypeCatalogPage (NUT-76)', () => {
  const queryRaw = jest.fn();
  const repository = new RecipeRepository({ $queryRaw: queryRaw } as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses stable id-ascending keyset pages with the same limit and no offset', async () => {
    queryRaw
      .mockResolvedValueOnce([{ id: 'catalog-01' }, { id: 'catalog-02' }])
      .mockResolvedValueOnce([{ id: 'catalog-03' }, { id: 'catalog-04' }]);

    const firstPage = await repository.findMealTypeCatalogPage({ limit: 2 });
    const secondPage = await repository.findMealTypeCatalogPage({ afterId: firstPage[firstPage.length - 1].id, limit: 2 });

    expect(firstPage.map(({ id }) => id)).toEqual(['catalog-01', 'catalog-02']);
    expect(secondPage.map(({ id }) => id)).toEqual(['catalog-03', 'catalog-04']);
    expect(new Set([...firstPage, ...secondPage].map(({ id }) => id)).size).toBe(4);
    expect(queryRaw).toHaveBeenCalledTimes(2);

    const [firstTemplate, firstCursor, firstLimit] = queryRaw.mock.calls[0];
    const [secondTemplate, secondCursor, secondLimit] = queryRaw.mock.calls[1];
    const firstSql = (firstTemplate as TemplateStringsArray).join(' ');
    const secondSql = (secondTemplate as TemplateStringsArray).join(' ');
    const firstCursorQuery = firstCursor as RawQuery;
    const secondCursorQuery = secondCursor as RawQuery;

    expect(firstSql).toContain('ORDER BY "id" ASC');
    expect(secondSql).toContain('ORDER BY "id" ASC');
    expect(firstSql).toContain('LIMIT');
    expect(secondSql).toContain('LIMIT');
    expect(firstSql).not.toContain('OFFSET');
    expect(secondSql).not.toContain('OFFSET');
    expect(firstCursorQuery.values).toEqual([]);
    expect(secondCursorQuery.sql).toContain('"id" >');
    expect(secondCursorQuery.values).toEqual(['catalog-02']);
    expect(firstLimit).toBe(2);
    expect(secondLimit).toBe(2);
  });
});

describe('RecipeRepository.findByNormalizedTitles (NUT-74, duplicados)', () => {
  const queryRaw = jest.fn();
  const repository = new RecipeRepository({ $queryRaw: queryRaw } as never);

  beforeEach(() => {
    jest.clearAllMocks();
    queryRaw.mockResolvedValue([]);
  });

  it('busca sólo las recetas con esos títulos normalizados, en una consulta parametrizada y acotada', async () => {
    await repository.findByNormalizedTitles(['ensalada de quinoa', "x' OR 1=1 --", 'ensalada de quinoa']);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const [template, ...values] = queryRaw.mock.calls[0];
    const sql = (template as TemplateStringsArray).join('?');

    expect(sql).toContain('SELECT "id", "title", "description", "ingredients", "instructions"');
    // unaccent primero: el resultado es ASCII antes de lower(), sin depender del locale de la base.
    expect(sql).toContain('lower(unaccent("title"))');
    expect(sql).toContain('= ANY(?::text[])');
    expect(sql).toContain('LIMIT ?');
    expect(sql).not.toContain('OR 1=1');
    expect(values[0]).toEqual(['ensalada de quinoa', "x' OR 1=1 --"]);
  });

  it('sin títulos no consulta la base', async () => {
    await expect(repository.findByNormalizedTitles([])).resolves.toEqual([]);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
