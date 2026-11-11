// NUT-114 — Catálogo curado del seed sintético: ingredientes reales (nombres en español, pensados para
// Argentina) y plantillas de recetas construidas solo con esos ingredientes. Datos estáticos, sin I/O.
import { IngredientType, MealType } from '../../src/generated/prisma/client';

/** Etiquetas propias del seed (reglas KETO/PALEO, que el dominio todavía no define). */
export type IngredientTag = 'legume' | 'sugar' | 'sweetFruit';

export interface NutritionPer100 {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

export interface CuratedIngredient {
  name: string;
  type: IngredientType;
  /** Los valores nutricionales son por 100 g, por 100 ml o por unidad, según esta unidad. */
  defaultUnit: 'g' | 'ml' | 'unidad';
  nutritionalValues: NutritionPer100;
  tags?: readonly IngredientTag[];
}

const ing = (
  name: string,
  type: IngredientType,
  defaultUnit: CuratedIngredient['defaultUnit'],
  [calories, protein, carbs, fat, fiber]: [number, number, number, number, number],
  tags: readonly IngredientTag[] = [],
): CuratedIngredient => ({ name, type, defaultUnit, nutritionalValues: { calories, protein, carbs, fat, fiber }, tags });

const { MEAT, VEGETABLE, FRUIT, DAIRY, GRAIN, SPICE, OTHER } = IngredientType;

// Nunca repetir "Pechuga de Pollo" ni "Arroz Integral" (son del seed base; el generador lo verifica).
export const CURATED_INGREDIENTS: readonly CuratedIngredient[] = [
  ing('Muslo de pollo', MEAT, 'g', [177, 24, 0, 8.5, 0]),
  ing('Carne picada magra', MEAT, 'g', [170, 20, 0, 10, 0]),
  ing('Bife de lomo', MEAT, 'g', [158, 22, 0, 7, 0]),
  ing('Lomo de cerdo', MEAT, 'g', [143, 21, 0, 6, 0]),
  ing('Pechuga de pavo', MEAT, 'g', [135, 30, 0, 1, 0]),
  ing('Filet de merluza', MEAT, 'g', [71, 16, 0, 0.9, 0]),
  ing('Salmón rosado', MEAT, 'g', [142, 20, 0, 6.3, 0]),
  ing('Atún al natural', MEAT, 'g', [116, 26, 0, 1, 0]),
  ing('Langostinos', MEAT, 'g', [85, 18, 0, 1, 0]),
  ing('Huevo', OTHER, 'unidad', [72, 6.3, 0.4, 4.8, 0]),
  ing('Tofu firme', OTHER, 'g', [144, 15.8, 2.8, 8.7, 2.3], ['legume']),
  ing('Lentejas cocidas', OTHER, 'g', [116, 9, 20, 0.4, 7.9], ['legume']),
  ing('Garbanzos cocidos', OTHER, 'g', [164, 8.9, 27, 2.6, 7.6], ['legume']),
  ing('Porotos negros cocidos', OTHER, 'g', [132, 8.9, 23.7, 0.5, 8.7], ['legume']),
  ing('Leche descremada', DAIRY, 'ml', [35, 3.4, 5, 0.1, 0]),
  ing('Yogur natural', DAIRY, 'g', [61, 3.5, 4.7, 3.3, 0]),
  ing('Queso cremoso', DAIRY, 'g', [300, 20, 2, 24, 0]),
  ing('Queso parmesano', DAIRY, 'g', [431, 38, 4, 29, 0]),
  ing('Ricota', DAIRY, 'g', [174, 11, 3, 13, 0]),
  ing('Arroz blanco', GRAIN, 'g', [130, 2.7, 28, 0.3, 0.4]),
  ing('Avena arrollada', GRAIN, 'g', [389, 16.9, 66, 6.9, 10.6]),
  ing('Quinoa cocida', GRAIN, 'g', [120, 4.4, 21, 1.9, 2.8]),
  ing('Fideos secos', GRAIN, 'g', [371, 13, 75, 1.5, 3.2]),
  ing('Pan integral', GRAIN, 'g', [247, 13, 41, 3.4, 7]),
  ing('Polenta', GRAIN, 'g', [370, 8, 79, 1.2, 4]),
  ing('Choclo', GRAIN, 'g', [86, 3.3, 19, 1.4, 2.7]),
  ing('Tomate perita', VEGETABLE, 'g', [18, 0.9, 3.9, 0.2, 1.2]),
  ing('Lechuga criolla', VEGETABLE, 'g', [15, 1.4, 2.9, 0.2, 1.3]),
  ing('Espinaca', VEGETABLE, 'g', [23, 2.9, 3.6, 0.4, 2.2]),
  ing('Brócoli', VEGETABLE, 'g', [34, 2.8, 6.6, 0.4, 2.6]),
  ing('Zapallito verde', VEGETABLE, 'g', [17, 1.2, 3.1, 0.3, 1]),
  ing('Zapallo anco', VEGETABLE, 'g', [45, 1, 11.7, 0.1, 2]),
  ing('Zanahoria', VEGETABLE, 'g', [41, 0.9, 9.6, 0.2, 2.8]),
  ing('Cebolla', VEGETABLE, 'g', [40, 1.1, 9.3, 0.1, 1.7]),
  ing('Morrón rojo', VEGETABLE, 'g', [31, 1, 6, 0.3, 2.1]),
  ing('Berenjena', VEGETABLE, 'g', [25, 1, 5.9, 0.2, 3]),
  ing('Pepino', VEGETABLE, 'g', [15, 0.7, 3.6, 0.1, 0.5]),
  ing('Coliflor', VEGETABLE, 'g', [25, 1.9, 5, 0.3, 2]),
  ing('Champiñones', VEGETABLE, 'g', [22, 3.1, 3.3, 0.3, 1]),
  ing('Papa', VEGETABLE, 'g', [77, 2, 17, 0.1, 2.2]),
  ing('Batata', VEGETABLE, 'g', [86, 1.6, 20, 0.1, 3]),
  ing('Rúcula', VEGETABLE, 'g', [25, 2.6, 3.7, 0.7, 1.6]),
  ing('Acelga', VEGETABLE, 'g', [19, 1.8, 3.7, 0.2, 1.6]),
  ing('Palta', FRUIT, 'g', [160, 2, 8.5, 14.7, 6.7]),
  ing('Ajo', SPICE, 'g', [149, 6.4, 33, 0.5, 2.1]),
  ing('Banana', FRUIT, 'unidad', [107, 1.3, 27, 0.4, 3.1], ['sweetFruit']),
  ing('Manzana roja', FRUIT, 'unidad', [94, 0.5, 25, 0.3, 4.3], ['sweetFruit']),
  ing('Frutillas', FRUIT, 'g', [32, 0.7, 7.7, 0.3, 2]),
  ing('Arándanos', FRUIT, 'g', [57, 0.7, 14.5, 0.3, 2.4]),
  ing('Naranja', FRUIT, 'unidad', [62, 1.2, 15.4, 0.2, 3.1], ['sweetFruit']),
  ing('Limón', FRUIT, 'unidad', [17, 0.6, 5.4, 0.2, 1.6]),
  ing('Nueces', OTHER, 'g', [654, 15, 14, 65, 6.7]),
  ing('Almendras', OTHER, 'g', [579, 21, 22, 50, 12.5]),
  ing('Semillas de chía', OTHER, 'g', [486, 17, 42, 31, 34]),
  ing('Semillas de zapallo', OTHER, 'g', [559, 30, 10.7, 49, 6]),
  ing('Maní tostado', OTHER, 'g', [567, 26, 16, 49, 8.5], ['legume']),
  ing('Aceite de oliva', OTHER, 'ml', [884, 0, 0, 100, 0]),
  ing('Leche de coco', OTHER, 'ml', [197, 2, 2.8, 21, 0]),
  ing('Miel', OTHER, 'g', [304, 0.3, 82, 0, 0.2], ['sugar']),
  ing('Azúcar mascabo', OTHER, 'g', [380, 0.1, 98, 0, 0], ['sugar']),
  ing('Sal fina', SPICE, 'g', [0, 0, 0, 0, 0]),
  ing('Pimentón dulce', SPICE, 'g', [282, 14, 54, 13, 35]),
  ing('Orégano', SPICE, 'g', [265, 9, 69, 4.3, 42.5]),
];

export interface CuratedRecipeTemplate {
  title: string;
  mealType: MealType;
  description: string;
  method: string;
  prepMinutes: number;
  cookMinutes: number;
  /** [nombre exacto de CURATED_INGREDIENTS, cantidad en su defaultUnit] */
  ingredients: ReadonlyArray<readonly [string, number]>;
}

type TemplateRow = [title: string, description: string, method: string, prep: number, cook: number, items: Array<[string, number]>];

const rows = (mealType: MealType, list: TemplateRow[]): CuratedRecipeTemplate[] =>
  list.map(([title, description, method, prepMinutes, cookMinutes, ingredients]) =>
    ({ title, mealType, description, method, prepMinutes, cookMinutes, ingredients }));

// En cada tipo de comida la primera plantilla es "universal" (vegana, sin frutos secos, soja, gluten, lácteos
// ni mariscos y apta KETO/PALEO): así todo perfil tiene al menos una opción aun con volúmenes chicos.
// Las siguientes siete son aptas KETO y PALEO (≤ 10 g de carbohidratos, sin granos, lácteos, legumbres ni azúcar).
const BREAKFAST = rows(MealType.BREAKFAST, [
  ['Bowl de palta, pepino y semillas de zapallo', 'Desayuno fresco y saciante con grasas buenas.', 'Cortar la palta y el pepino en cubos y cubrir con las semillas.', 5, 0,
    [['Palta', 70], ['Pepino', 50], ['Semillas de zapallo', 20]]],
  ['Huevos revueltos con espinaca', 'Revuelto rápido con hojas verdes.', 'Saltear la espinaca en el aceite y agregar los huevos batidos hasta que cuajen.', 5, 5,
    [['Huevo', 2], ['Espinaca', 60], ['Aceite de oliva', 5]]],
  ['Omelette de champiñones y morrón', 'Omelette liviano con verduras salteadas.', 'Dorar los champiñones y el morrón, volcar los huevos batidos y plegar.', 5, 8,
    [['Huevo', 2], ['Champiñones', 60], ['Morrón rojo', 40], ['Aceite de oliva', 5]]],
  ['Huevos pochados sobre palta', 'Huevos pochados servidos sobre palta pisada.', 'Pochar los huevos en agua apenas hirviendo y servir sobre la palta pisada.', 5, 5,
    [['Huevo', 2], ['Palta', 60]]],
  ['Revuelto de pavo y tomate', 'Desayuno proteico con pavo y tomate.', 'Dorar el pavo en tiras, sumar el tomate y el huevo batido y revolver.', 5, 7,
    [['Pechuga de pavo', 80], ['Tomate perita', 60], ['Huevo', 1]]],
  ['Frittata de zapallito y cebolla', 'Frittata al sartén con verduras de estación.', 'Rehogar la cebolla y el zapallito, cubrir con los huevos y cocinar tapado.', 8, 12,
    [['Huevo', 3], ['Zapallito verde', 100], ['Cebolla', 30], ['Aceite de oliva', 5]]],
  ['Tortilla de acelga', 'Tortilla casera de acelga.', 'Blanquear la acelga, picarla, mezclar con los huevos y dorar de ambos lados.', 8, 10,
    [['Huevo', 2], ['Acelga', 100], ['Aceite de oliva', 5]]],
  ['Bowl de salmón y palta', 'Bowl salado con salmón rosado.', 'Cocinar el salmón a la plancha y servir con palta y pepino en cubos.', 5, 8,
    [['Salmón rosado', 80], ['Palta', 50], ['Pepino', 50]]],
  ['Avena con banana y miel', 'Avena cocida con leche y fruta.', 'Cocinar la avena en la leche, servir con la banana en rodajas y la miel.', 3, 5,
    [['Avena arrollada', 50], ['Leche descremada', 200], ['Banana', 1], ['Miel', 10]]],
  ['Yogur con frutillas y nueces', 'Yogur natural con fruta fresca.', 'Servir el yogur con las frutillas cortadas y las nueces picadas.', 5, 0,
    [['Yogur natural', 150], ['Frutillas', 80], ['Nueces', 15]]],
  ['Tostadas integrales con ricota y tomate', 'Tostadas con ricota y rodajas de tomate.', 'Tostar el pan, untar la ricota y cubrir con el tomate en rodajas.', 5, 3,
    [['Pan integral', 60], ['Ricota', 50], ['Tomate perita', 50]]],
  ['Quinoa con manzana y almendras', 'Bowl tibio de quinoa con fruta.', 'Calentar la quinoa y servir con la manzana en cubos y las almendras.', 5, 3,
    [['Quinoa cocida', 150], ['Manzana roja', 1], ['Almendras', 15]]],
  ['Pudding de chía con leche de coco y arándanos', 'Pudding frío preparado la noche anterior.', 'Hidratar la chía en la leche de coco en la heladera y servir con arándanos.', 5, 0,
    [['Semillas de chía', 25], ['Leche de coco', 150], ['Arándanos', 50]]],
]);

const LUNCH = rows(MealType.LUNCH, [
  ['Salteado de espinaca y champiñones al ajo', 'Salteado verde rápido y aromático.', 'Dorar el ajo en el aceite, sumar los champiñones y luego la espinaca.', 8, 8,
    [['Espinaca', 100], ['Champiñones', 150], ['Aceite de oliva', 10], ['Ajo', 3]]],
  ['Muslo de pollo al horno con brócoli', 'Pollo al horno con guarnición verde.', 'Hornear el pollo hasta dorar y servir con el brócoli al vapor.', 10, 35,
    [['Muslo de pollo', 180], ['Brócoli', 120], ['Aceite de oliva', 10]]],
  ['Bife de lomo con ensalada de rúcula', 'Bife a la plancha con ensalada fresca.', 'Sellar el bife a fuego fuerte y servir con rúcula y tomate.', 10, 10,
    [['Bife de lomo', 180], ['Rúcula', 50], ['Tomate perita', 80], ['Aceite de oliva', 10]]],
  ['Merluza a la plancha con espinaca', 'Pescado blanco liviano con hojas salteadas.', 'Cocinar la merluza a la plancha y saltear la espinaca con ajo.', 8, 10,
    [['Filet de merluza', 200], ['Espinaca', 120], ['Ajo', 3]]],
  ['Carne picada con zapallitos', 'Salteado casero de carne y verduras.', 'Dorar la carne con la cebolla y sumar los zapallitos en cubos.', 10, 15,
    [['Carne picada magra', 150], ['Zapallito verde', 150], ['Cebolla', 40]]],
  ['Lomo de cerdo con coliflor salteada', 'Cerdo dorado con coliflor.', 'Dorar el cerdo en medallones y saltear la coliflor en el mismo sartén.', 10, 20,
    [['Lomo de cerdo', 180], ['Coliflor', 120], ['Aceite de oliva', 10]]],
  ['Ensalada de atún, huevo y lechuga', 'Ensalada completa y fresca.', 'Hervir el huevo, cortar las verduras y mezclar con el atún escurrido.', 10, 10,
    [['Atún al natural', 120], ['Huevo', 1], ['Lechuga criolla', 80], ['Tomate perita', 50], ['Aceite de oliva', 10]]],
  ['Pavo grillado con berenjenas', 'Pavo a la parrilla con berenjenas asadas.', 'Grillar el pavo y las berenjenas en rodajas con un hilo de aceite.', 10, 15,
    [['Pechuga de pavo', 180], ['Berenjena', 120], ['Aceite de oliva', 10]]],
  ['Arroz blanco con lentejas y verduras', 'Plato vegetal completo.', 'Cocinar el arroz, rehogar la cebolla y la zanahoria y sumar las lentejas.', 10, 20,
    [['Arroz blanco', 150], ['Lentejas cocidas', 120], ['Zanahoria', 60], ['Cebolla', 40]]],
  ['Fideos con salsa de tomate y queso', 'Clásico casero con salsa simple.', 'Hervir los fideos, preparar la salsa de tomate y servir con queso parmesano.', 5, 15,
    [['Fideos secos', 90], ['Tomate perita', 150], ['Queso parmesano', 15]]],
  ['Bowl de quinoa, garbanzos y espinaca', 'Bowl vegetal con legumbres.', 'Mezclar la quinoa con los garbanzos y la espinaca y aliñar con el aceite.', 10, 0,
    [['Quinoa cocida', 150], ['Garbanzos cocidos', 100], ['Espinaca', 50], ['Aceite de oliva', 5]]],
  ['Langostinos salteados con arroz', 'Salteado de mar con arroz.', 'Saltear los langostinos con el morrón y servir sobre el arroz.', 10, 15,
    [['Langostinos', 150], ['Arroz blanco', 150], ['Morrón rojo', 60]]],
  ['Tofu salteado con brócoli y arroz', 'Salteado oriental vegetal.', 'Dorar el tofu en cubos, sumar el brócoli y servir con el arroz.', 10, 15,
    [['Tofu firme', 150], ['Brócoli', 100], ['Arroz blanco', 120]]],
]);

const SNACK = rows(MealType.SNACK, [
  ['Bastones de pepino con palta', 'Colación fresca para picar.', 'Cortar el pepino en bastones y servir con la palta pisada.', 5, 0,
    [['Pepino', 150], ['Palta', 50]]],
  ['Huevo duro con tomate', 'Colación simple y proteica.', 'Hervir los huevos diez minutos y servir con el tomate en gajos.', 3, 10,
    [['Huevo', 2], ['Tomate perita', 80]]],
  ['Rollitos de pavo con pepino', 'Rollitos frescos para la tarde.', 'Enrollar las fetas de pavo alrededor de bastones de pepino.', 5, 0,
    [['Pechuga de pavo', 60], ['Pepino', 80]]],
  ['Palta rellena con atún', 'Media palta con atún.', 'Abrir la palta, retirar el carozo y rellenar con el atún escurrido.', 5, 0,
    [['Palta', 70], ['Atún al natural', 60]]],
  // Evitar "tostada(s)": es palabra clave de gluten en el diccionario del dominio.
  ['Semillas de zapallo al sartén', 'Puñado de semillas doradas.', 'Dorar las semillas en sartén seca hasta que se inflen.', 2, 5,
    [['Semillas de zapallo', 30]]],
  ['Bastones de morrón con palta', 'Verduras crocantes con palta.', 'Cortar el morrón en tiras y servir con la palta pisada.', 5, 0,
    [['Morrón rojo', 80], ['Palta', 50]]],
  ['Salmón rosado con pepino', 'Bocados de salmón sobre rodajas de pepino.', 'Cocinar el salmón, desmenuzarlo y servir sobre rodajas de pepino.', 5, 8,
    [['Salmón rosado', 50], ['Pepino', 80]]],
  ['Champiñones rellenos de huevo', 'Champiñones al horno.', 'Rellenar los champiñones con el huevo batido y hornear hasta cuajar.', 5, 12,
    [['Champiñones', 100], ['Huevo', 1], ['Aceite de oliva', 5]]],
  ['Yogur con arándanos', 'Colación láctea con fruta.', 'Servir el yogur con los arándanos por encima.', 2, 0,
    [['Yogur natural', 150], ['Arándanos', 50]]],
  ['Manzana con maní', 'Fruta con maní tostado.', 'Cortar la manzana en gajos y acompañar con el maní.', 3, 0,
    [['Manzana roja', 1], ['Maní tostado', 20]]],
  ['Banana con almendras', 'Colación dulce y práctica.', 'Cortar la banana en rodajas y sumar las almendras.', 2, 0,
    [['Banana', 1], ['Almendras', 15]]],
  ['Hummus de garbanzos con zanahoria', 'Dip de legumbres con bastones.', 'Procesar los garbanzos con el aceite y servir con bastones de zanahoria.', 10, 0,
    [['Garbanzos cocidos', 100], ['Zanahoria', 80], ['Aceite de oliva', 5]]],
  ['Tostada integral con queso cremoso', 'Tostada tibia con queso.', 'Tostar el pan y cubrir con el queso hasta que se ablande.', 2, 3,
    [['Pan integral', 40], ['Queso cremoso', 30]]],
]);

const DINNER = rows(MealType.DINNER, [
  ['Zapallitos y berenjenas grillados con oliva', 'Verduras a la plancha con aceite de oliva.', 'Cortar en rodajas, grillar de ambos lados y rociar con el aceite.', 8, 12,
    [['Zapallito verde', 150], ['Berenjena', 80], ['Aceite de oliva', 10]]],
  ['Salmón al horno con brócoli', 'Salmón jugoso con guarnición verde.', 'Hornear el salmón quince minutos y servir con el brócoli al vapor.', 8, 15,
    [['Salmón rosado', 180], ['Brócoli', 120]]],
  ['Pollo al ajo con espinaca', 'Pollo dorado con ajo y hojas verdes.', 'Dorar el pollo, sumar el ajo picado y terminar con la espinaca.', 10, 25,
    [['Muslo de pollo', 180], ['Espinaca', 120], ['Ajo', 5]]],
  ['Tortilla de espinaca y champiñones', 'Tortilla liviana para la noche.', 'Saltear las verduras, cubrir con los huevos batidos y dar vuelta.', 8, 10,
    [['Huevo', 3], ['Espinaca', 80], ['Champiñones', 80]]],
  ['Carne al horno con morrones', 'Lomo al horno con morrones asados.', 'Hornear el lomo con los morrones y la cebolla en tiras.', 10, 30,
    [['Bife de lomo', 180], ['Morrón rojo', 100], ['Cebolla', 30]]],
  ['Merluza con zapallitos', 'Pescado blanco con verduras salteadas.', 'Cocinar la merluza a la plancha y saltear los zapallitos con el aceite.', 8, 12,
    [['Filet de merluza', 200], ['Zapallito verde', 150], ['Aceite de oliva', 10]]],
  ['Lomo de cerdo con champiñones', 'Cerdo salteado con champiñones.', 'Dorar el cerdo, sumar el ajo y los champiñones y cocinar hasta reducir.', 10, 20,
    [['Lomo de cerdo', 180], ['Champiñones', 120], ['Ajo', 3]]],
  ['Albóndigas de carne con salsa de tomate', 'Albóndigas caseras en salsa.', 'Formar las albóndigas con la carne, el huevo y el ajo y cocinarlas en la salsa de tomate.', 15, 25,
    [['Carne picada magra', 150], ['Tomate perita', 120], ['Huevo', 1], ['Ajo', 3]]],
  ['Papas al horno con pollo', 'Clásico al horno.', 'Hornear el pollo junto con las papas en gajos hasta dorar.', 10, 45,
    [['Muslo de pollo', 150], ['Papa', 200], ['Aceite de oliva', 10]]],
  ['Polenta con salsa de tomate y queso', 'Polenta cremosa con salsa.', 'Cocinar la polenta, cubrir con la salsa de tomate y el queso.', 5, 15,
    [['Polenta', 70], ['Tomate perita', 150], ['Queso cremoso', 40]]],
  ['Guiso de lentejas y zapallo', 'Guiso vegetal reconfortante.', 'Rehogar la cebolla y la zanahoria, sumar el zapallo y las lentejas y cocinar.', 15, 30,
    [['Lentejas cocidas', 150], ['Zapallo anco', 120], ['Cebolla', 40], ['Zanahoria', 50]]],
  ['Batatas asadas con garbanzos', 'Batatas al horno con legumbres.', 'Asar las batatas en cubos y mezclar con los garbanzos tibios.', 10, 35,
    [['Batata', 200], ['Garbanzos cocidos', 100], ['Aceite de oliva', 10]]],
  ['Tofu con verduras salteadas', 'Salteado vegetal con tofu.', 'Dorar el tofu y saltear con el morrón y el zapallito.', 10, 12,
    [['Tofu firme', 150], ['Morrón rojo', 60], ['Zapallito verde', 100]]],
]);

function interleave<T>(...lists: T[][]): T[] {
  const length = Math.max(...lists.map((list) => list.length));
  const result: T[] = [];
  for (let i = 0; i < length; i += 1) for (const list of lists) if (i < list.length) result.push(list[i]);
  return result;
}

/** Orden B/L/S/D intercalado: las cuatro primeras son las plantillas universales. */
export const CURATED_RECIPES: readonly CuratedRecipeTemplate[] = interleave(BREAKFAST, LUNCH, SNACK, DINNER);
