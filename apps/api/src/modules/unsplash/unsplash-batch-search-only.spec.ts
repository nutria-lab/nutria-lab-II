// NUT-83 - gap real verificado contra el código actual (no hipotético; ver también el comentario
// equivalente en apps/api/src/modules/plans/tests/plans.service.spec.ts, describe "NUT-83 gap
// real: tracking de download_location con UnsplashService REAL"): `PlansService.resolveImagesOrDegrade`
// sigue llamando a `UnsplashService.attachImages(days)`, el método VIEJO que hace búsqueda +
// selección + tracking de `download_location` TODO JUNTO, antes de que la receta exista en la
// base de datos. design.md 12.5.2 ("Cuándo se dispara exactamente la actualización de tracking")
// exige separar esa responsabilidad en dos pasos: paso 1 (búsqueda + selección, arma el `image`
// con `tracking.status = 'PENDING'`, SIN llamar nunca a `download_location`) y paso 3 (tracking,
// disparado por el caller DESPUÉS de que la escritura de persistencia ya resolvió).
//
// El camino de creación manual individual (`RecipeService.create` + `UnsplashService.
// searchAndSelectCandidate`/`trackDownload`) ya respeta esta separación y está cubierto por
// unsplash.service.spec.ts (describe "Ciclo B"). El camino de BATCH de un plan (`attachImages`,
// usado por `PlansService`) todavía NO la respeta: sigue resolviendo tracking adentro suyo, antes
// de que `createPlanTransaction` se invoque siquiera.
//
// Este archivo fija el contrato esperado para un método orquestador de BATCH que haga SOLO
// búsqueda+selección (mismo rol que `attachImages` hoy, pero sin el tracking adentro).
//
// DECISIÓN DE NOMBRE (no fijada por design.md/plan.md; documentada acá por instrucción explícita
// de esta sesión, ya que ningún documento previo nombra este método): se elige
// `searchAndSelectImages(days)` por simetría directa con el método singular ya existente
// `searchAndSelectCandidate(title)` (search+select, sin tracking, design.md 12.5.2 paso 1) -
// mismo prefijo, mismo contrato de "sin tracking", versión batch sobre `MealPlanDayDto[]` en vez
// de un único título. El método NO EXISTE TODAVÍA en `unsplash.service.ts`: este test debe fallar
// en rojo (`TypeError: service.searchAndSelectImages is not a function`) hasta que el
// implementer lo agregue. Si el implementer prefiere otro nombre, este test debe actualizarse en
// el mismo cambio - ningún otro archivo depende de este nombre todavía.
import { ConfigService } from '@nestjs/config';
import { UnsplashService } from './unsplash.service';

const MOCK_API_KEY = 'test-unsplash-key-batch-no-tracking';

function createConfigServiceMock(apiKeyValue: string | undefined) {
  return {
    get: jest.fn((key: string) => (key === 'UNSPLASH_ACCESS_KEY' ? apiKeyValue : undefined)),
  } as unknown as ConfigService;
}

// Mismo candidato válido usado en unsplash.service.spec.ts: dominios exactos exigidos por
// design.md 12.3 (images.unsplash.com / unsplash.com / api.unsplash.com), `id` string (12.2).
function validCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'LBI7cgq3pbM',
    urls: { regular: 'https://images.unsplash.com/photo-998877?w=1080' },
    links: {
      html: 'https://unsplash.com/photos/998877',
      download_location: 'https://api.unsplash.com/photos/998877/download',
    },
    user: { name: 'Jane Doe', links: { html: 'https://unsplash.com/@jane-doe' } },
    alt_description: 'Comida servida en un plato',
    width: 1920,
    height: 1280,
    ...overrides,
  };
}

function buildDay(dayLabel: string, date: string, title: string) {
  return {
    day: dayLabel,
    date,
    meals: [
      {
        mealType: 'LUNCH',
        title,
        nutritionalValues: { Protein: 20, Fiber: 8, Calories: 350, Description: 'Almuerzo' },
        recipe: {
          title,
          description: 'Receta de prueba',
          prepMinutes: 10,
          cookMinutes: 15,
          ingredients: [{ name: 'Ingrediente', quantity: 100, unit: 'g' }],
          instructions: ['Paso unico'],
        },
      },
    ],
  };
}

describe('UnsplashService - batch de búsqueda+selección SIN tracking (design.md 12.5.2 paso 1, gap real)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('resuelve cada receta nueva del batch con image.tracking.status === "PENDING", habiendo llamado a fetch SÓLO para la búsqueda (nunca a una URL de download_location)', async () => {
    const configService = createConfigServiceMock(MOCK_API_KEY);
    const candidate = validCandidate();

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [candidate] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    // Cast a `any`: el método bajo prueba todavía no existe en el tipo público de
    // UnsplashService (ver "DECISIÓN DE NOMBRE" arriba) - el cast es lo que permite que esta
    // prueba falle en rojo por ausencia de implementación, no por un error de compilación.
    const service = new UnsplashService(configService) as any;

    const days = [buildDay('MONDAY', '2026-09-14', 'Ensalada de Quinoa'), buildDay('TUESDAY', '2026-09-15', 'Tacos de Pollo')];

    const result = await service.searchAndSelectImages(days);

    const recipeImages = result.flatMap((day: any) => day.meals.map((meal: any) => meal.recipe.image));

    expect(recipeImages).toHaveLength(2);
    for (const image of recipeImages) {
      expect(image).not.toBeNull();
      // design.md 12.5.2 paso 1: el `image` ya se arma completo, pero con tracking en PENDING -
      // nunca se llama a download_location en este paso.
      expect(image.tracking).toEqual({
        status: 'PENDING',
        lastAttemptAt: null,
        trackingUrl: candidate.links.download_location,
      });
    }

    // Ninguna llamada a fetch debe apuntar a una URL de download_location - contando por URL
    // real invocada, no por cantidad total, para que la aserción no dependa de si hay o no
    // memoización por query normalizada entre las dos recetas del batch.
    const downloadCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/download'));
    expect(downloadCalls).toHaveLength(0);
    // Al menos una llamada de búsqueda sí debe haber ocurrido (sanity check: si esto fuera 0, la
    // aserción de arriba sería trivialmente verdadera sin haber probado nada).
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
  });
});
