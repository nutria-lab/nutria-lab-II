# Reporte de Cambios: NUT-20 (Recipe & Ingredient Contract)

Este documento detalla exhaustivamente los archivos que fueron modificados como parte del desarrollo del ticket NUT-20. Explica la razón detrás de cada cambio e incluye fragmentos de código relevantes para ilustrar las decisiones tomadas.

---

## 1. Prisma Schema & Migraciones

Para cumplir con el requerimiento de soportar categorías predefinidas, propiedades de texto libre y valores nutricionales (manuales) sin afectar los flujos existentes (como la creación por Meal Plans), agregamos los campos con defaults seguros.

### `apps/api/prisma/models/recipe.prisma`
Se incluyó el enum `RecipeCategory` y los nuevos campos. Al definir `categories` y `properties` con `@default([])` y `nutritionalValues` como `Json?`, nos aseguramos de que el repositorio de *Plans* no se rompa al crear recetas sin proveer estos metadatos.

```prisma
enum RecipeCategory {
  VEGAN
  VEGETARIAN
  HIGH_PROTEIN
  GLUTEN_FREE
  DAIRY_FREE
  LOW_CARB
  OTHER
}

model Recipe {
  id                String             @id @default(uuid())
  title             String
  description       String
  prepMinutes       Int
  cookMinutes       Int
  ingredients       Json
  instructions      String[]
  // Nuevos campos:
  categories        RecipeCategory[]   @default([])
  nutritionalValues Json?
  properties        String[]           @default([])

  createdAt         DateTime           @default(now())
  updatedAt         DateTime           @updatedAt
  plannedMeals      PlannedMeal[]

  @@map("recipes")
}
```

### `apps/api/prisma/models/ingredient.prisma`
Se añadieron los campos opcionales `description` y `defaultUnit`, así como `properties`. El requerimiento sobre `sodium` no necesitó columna nueva ya que habita dentro del campo existente `nutritionalValues` (que es de tipo `Json`).

```prisma
model Ingredient {
  id                String             @id @default(uuid())
  name              String             @unique
  type              IngredientType
  description       String?
  defaultUnit       String?
  nutritionalValues Json
  properties        String[]           @default([])
  
  createdAt         DateTime           @default(now())
  updatedAt         DateTime           @updatedAt

  @@map("ingredients")
}
```

> [!NOTE] 
> Automáticamente se generó la migración aditiva `20260916130941_nut20_contract` para persistir estos esquemas sin pérdida de datos en la base.

---

## 2. Contratos DTO y Validación HTTP

### Utilidad centralizada de normalización: `apps/api/src/utils/normalize-properties.util.ts`
Para mantener los DTOs limpios, declarativos y evitar duplicación de código (DRY), extrajimos la lógica algorítmica de limpieza a una función utilitaria pura y su correspondiente decorador `@NormalizeProperties()`:

```typescript
export function normalizeProperties(properties: string[]): string[] {
  if (!Array.isArray(properties)) return [];
  const normalized = properties
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim().replace(/\s+/g, ' '))
    .filter(item => item.length > 0);

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const item of normalized) {
    const lower = item.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      unique.push(item);
    }
  }
  return unique;
}

export function NormalizeProperties() {
  return Transform(({ value }) => {
    if (!Array.isArray(value)) return value;
    return normalizeProperties(value);
  });
}
```

### DTOs limpios y declarativos
- `apps/api/src/modules/recipe/dto/create-recipe.dto.ts`
- `apps/api/src/modules/recipe/dto/update-recipe.dto.ts`

```typescript
import { NormalizeProperties } from '@/utils/normalize-properties.util';

export class CreateRecipeDto {
  // ...
  @IsObject()
  @ValidateNested()
  @Type(() => RecipeNutritionalValuesDto)
  nutritionalValues!: RecipeNutritionalValuesDto;

  @IsArray()
  @IsString({ each: true })
  @NormalizeProperties()
  properties!: string[];
}
```

### DTOs de Ingredient
- `apps/api/src/modules/ingredient/dto/create-ingredient.dto.ts`
- `apps/api/src/modules/ingredient/dto/update-ingredient.dto.ts`

Aquí extendimos `IngredientNutritionalValuesDto` agregando explícitamente `fiber` y `sodium` para que el `ValidationPipe` autorice su persistencia dentro del JSON. También se incluyó la misma normalización de `@Transform` para las propiedades.

```typescript
export class IngredientNutritionalValuesDto {
  // ... calories, protein, carbs, fat
  @IsNumber()
  @Min(0)
  @IsOptional()
  fiber?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  sodium?: number;
}
```

---

## 3. Lógica de Repositorios

Al manejar campos tipo `Json` en Prisma con variables tipadas desde los DTOs, TypeScript puede quejarse de la validación exacta de las llaves, por lo cual se realizó un casteo seguro para la inyección.

### `apps/api/src/modules/recipe/recipe.repository.ts`
Se agregaron adaptaciones en `create` y `update`. La estructura `PATCH` de NestJS hace que reemplazar el array entero sea el comportamiento predeterminado, satisfaciendo el requerimiento de que no exista append incremental.

```typescript
  async update(id: string, data: UpdateRecipeDto) {
    return this.prisma.recipe.update({
      where: { id },
      data: {
        ...data,
        ...(data.ingredients ? { ingredients: data.ingredients as any } : {}),
        ...(data.nutritionalValues ? { nutritionalValues: data.nutritionalValues as any } : {}),
      },
    });
  }
```
*(Nota: El repositorio de Ingredient no necesitó grandes modificaciones ya que aplicaba esta lógica sobre `nutritionalValues` desde un commit anterior).*

---

## 4. Datos Iniciales (Seeding)

### `apps/api/prisma/seed.ts`
Actualizamos los fixtures predeterminados para garantizar que el ambiente de desarrollo arranque con datos de ejemplo que reflejan fielmente los nuevos campos (`description`, `sodium`, `categories`, `properties`), asegurando de paso la idempotencia para su re-ejecución.

```typescript
  await prisma.ingredient.upsert({
    where: { name: 'Pechuga de Pollo' },
    update: {},
    create: {
      name: 'Pechuga de Pollo',
      type: IngredientType.MEAT,
      description: 'Corte magro de pollo, ideal para dietas altas en proteínas.',
      defaultUnit: 'g',
      nutritionalValues: { calories: 165, protein: 31, carbs: 0, fat: 3.6, sodium: 74 },
      properties: ['Alto en Proteína', 'Bajo en Grasa']
    }
  });
```

---

## 5. Pruebas Aisladas (Testing)

Para garantizar la fiabilidad técnica e impedir regresiones futuras, implementamos tests enfocados únicamente en la estabilidad de los contratos descritos.

### Tests Unitarios (Validación de DTOs)
- `apps/api/src/modules/recipe/tests/recipe.dto.spec.ts`
- `apps/api/src/modules/ingredient/tests/ingredient.dto.spec.ts`

```typescript
  it('should normalize properties array (trim, deduplicate, case-insensitive)', () => {
    const plain = {
      // ...
      properties: [' Sin Gluten ', 'Alto en Fibra', 'sin gluten', '  ', 'ALTO EN FIBRA']
    };
    const instance = plainToInstance(CreateRecipeDto, plain);

    // Conserva 'Sin Gluten' descartando la reincidencia 'sin gluten' 
    // y colapsa los espacios y valores vacíos.
    expect(instance.properties).toEqual(['Sin Gluten', 'Alto en Fibra']); 
  });
```

### Test de Integración a BD (Compatibilidad con Meal Plans)
- `apps/api/src/modules/plans/tests/plans.db-integration.spec.ts`

El módulo de Meal Plans sigue creando `Recipes` subyacentes sin pasar explícitamente `categories` ni `properties`. Escribimos una prueba persistida con una transacción real en Postgres/Prisma para afirmar que el mecanismo defensivo (los defaults) actúa correctamente.

```typescript
    const recipe = await prisma.recipe.findUnique({ where: { id: recipeId! } });
    expect(recipe).toBeDefined();
    expect(recipe?.categories).toEqual([]);
    expect(recipe?.properties).toEqual([]);
    expect(recipe?.nutritionalValues).toBeNull();
```

### Actualización de mocks existentes
- `apps/api/src/modules/ingredient/tests/ingredient.service.spec.ts`
- `apps/api/src/modules/recipe/tests/recipe.service.spec.ts`

Se añadieron `properties: []` y macros nutricionales en los payloads ficticios de tests anteriores que fallaban porque el sistema comenzó a interpretarlos como parámetros _required_.
