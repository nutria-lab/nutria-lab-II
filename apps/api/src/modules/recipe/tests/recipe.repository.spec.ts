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

  /**
   * NUT-83 (design.md sección 8/plan.md sección 7, fila AC10) — `findAll` arma su SELECT con
   * una lista EXPLÍCITA de columnas (no `SELECT *`), y esa lista hoy no incluye `"image"`. Como
   * `image` se persiste una sola vez en creación (Flujo A de design.md) y nunca se recalcula en
   * lectura, cualquier camino de lectura existente debe devolverlo tal cual quedó guardado — acá
   * se verifica el camino de listado (`GET /recipes`), que es el único de los tres
   * (`findAll`/`findById`/`findByTitle`) que no usa el modelo completo de Prisma por defecto y
   * por lo tanto es el único que puede omitir una columna nueva por construcción.
   *
   * Este test debe fallar en rojo hasta que el implementer agregue `"image"` a la lista de
   * columnas del SELECT de items en `recipe.repository.ts`.
   */
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
