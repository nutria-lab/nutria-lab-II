# Seed sintético de NutrIA (NUT-114)

> **Todos los datos que carga este seed son sintéticos.** Sirven para recorrer y demostrar la app sin cargar registros a mano. No representan usuarios ni uso real, y no deben presentarse como tales en métricas, KPIs ni demos con clientes.

El seed sintético amplía el seed existente (`pnpm seed`): primero corre la parte base de siempre (ingredientes y receta base, `usuario.prueba1–3` y su plan) y después, solo si se activa, carga unas 200.000 filas sintéticas coherentes entre sí.

## Contenido

1. [Cómo correrlo](#cómo-correrlo)
2. [Protección del destino](#protección-del-destino)
3. [Qué carga](#qué-carga)
4. [Inventario de modelos](#inventario-de-modelos)
5. [Reejecutar](#reejecutar)
6. [Cuenta de recorrido](#cuenta-de-recorrido)
7. [KPIs en la base demo](#kpis-en-la-base-demo)
8. [Fallos y recuperación](#fallos-y-recuperación)
9. [Limitaciones conocidas](#limitaciones-conocidas)
10. [Evidencia de las corridas](#evidencia-de-las-corridas)

---

## Cómo correrlo

Solo contra una base **local y dedicada**. La base tiene que tener las migraciones aplicadas.

Comando (PowerShell, una línea, desde la raíz del repo). Reemplazá los valores entre `<>`; no los guardes en archivos del repo:

```
$env:DATABASE_URL = "postgresql://<usuario>:<contraseña>@localhost:5433/nutria_seed_demo"; $env:DIRECT_URL = $env:DATABASE_URL; $env:DATABASE_URL_UNPOOLED = $env:DATABASE_URL; $env:SEED_SYNTHETIC = "true"; $env:SEED_CONFIRM_TARGET = "localhost/nutria_seed_demo"; $env:SEED_DEMO_PASSWORD = "<contraseña-de-la-cuenta-demo>"; pnpm seed
```

Las tres variables de URL apuntan a la misma base para que ninguna herramienta tome una distinta de `apps/api/.env` (dotenv no pisa variables ya definidas). No uses `npx prisma db seed`: en Prisma 7 ese comando lee el seed de `prisma.config.ts`, que no lo tiene configurado.

### Variables

| Variable | Obligatoria | Qué hace |
|---|---|---|
| `DATABASE_URL` | sí | Base destino. También se validan `DATABASE_URL_UNPOOLED` y `DIRECT_URL` si están definidas. |
| `SEED_SYNTHETIC` | para la parte sintética | Solo `true` activa la carga sintética. Sin ella corre solo la parte base. |
| `SEED_CONFIRM_TARGET` | con `SEED_SYNTHETIC=true` | `host/base` del destino, escrito a mano. Tiene que coincidir con `DATABASE_URL`. |
| `SEED_DEMO_PASSWORD` | con `SEED_SYNTHETIC=true` | Contraseña de `demo.seed.00001@nutria.test`. Se hashea una vez con bcrypt y nunca se imprime. |
| `SEED_ALLOWED_TARGETS` | no | Destinos remotos permitidos (`host/base`, separados por coma). Vacía: solo localhost. |
| `SEED_SYNTHETIC_USERS` | no | Volumen, de 1 a 5000 (por defecto 5000). Escala todas las tablas. |
| `SEED_BATCH_SIZE` | no | Filas por lote (por defecto 1000). |

## Protección del destino

Antes de crear cualquier conexión, el guard revisa el destino:

- **Bloquea** si `NODE_ENV`, `KPI_ENV` o `VERCEL_ENV` valen `production`.
- **Permite** siempre `localhost`, `127.0.0.1` y `::1`. Cualquier otro host tiene que figurar exacto en `SEED_ALLOWED_TARGETS`. Ninguna de las URLs de base definidas puede quedar fuera.
- En Neon el host no incluye el nombre de la rama, así que la allowlist se escribe por endpoint exacto (`ep-…/base`). Las variantes con y sin `-pooler` cuentan como el mismo destino.
- Los mensajes y logs muestran el host enmascarado y el nombre de la base. Nunca muestran usuario, contraseña ni URL completa.

> Este guard también protege la **parte base** del seed: correr `pnpm seed` contra un host remoto ahora exige ese host en `SEED_ALLOWED_TARGETS`. El seed no corre en ningún pipeline ni deploy (CI, workflows de KPI y build de Vercel no lo invocan).

## Qué carga

| Convención | Valor |
|---|---|
| Emails | `demo.seed.00001@nutria.test` … `demo.seed.05000@nutria.test` (dominio `.test`, reservado) |
| Nombres | `Demo Sintético 00001` … `Demo Sintético 05000` |
| IDs | `5eedTTTT-0000-4000-8000-NNNNNNNNNNNN`, determinísticos. `TTTT` es la tabla: 0001 users, 0002 recipes, 0003 meal plans, 0004 days, 0005 meals, 0006 profiles, 0007 ingredients, 0008 completions, 0009 shopping checks |
| IDs de la semana actual | último segmento `9YYYYMMDD…`, derivado del lunes de esa semana |
| Reservados | `usuario.prueba*` y `qa.*` (cohorte QA de NUT-105). El seed sintético no los crea ni los toca. |

- **Generación local y determinística**: no llama a IA, Unsplash ni otros servicios. Mismo volumen y misma fecha dan exactamente los mismos datos.
- **Credenciales**: solo `demo.seed.00001` puede iniciar sesión. Los otros 4999 usuarios tienen un valor que no es un hash bcrypt (`!synthetic-no-login`), así que el login responde 401. Ningún usuario tiene rol ni permisos extra.
- **Planes pasados**: un plan por usuario en lunes fijos desde 2026-01-05, rotando 40 semanas (el último termina el 2026-10-11). Cada uno tiene 7 días × 4 comidas (desayuno, almuerzo, merienda, cena). La nutrición de cada comida coincide con la de su receta.
- **Recetas**: 5000, `MANUAL`, con `createdAt` fijo en el pasado (2025-12-01) y sin imagen. Respetan la dieta y las restricciones del perfil que las recibe.
- **Ingredientes**: 63 curados (reales) más 4937 combinatorios ("base × presentación × tamaño", por ejemplo `Semillas de chía a granel 100 g`). Las recetas masivas usan **4937 de 4937 combinatorios (100,00 %)**. Cada variante se clasifica igual que su ingrediente base en las 9 reglas del dominio (gluten, lácteos, frutos secos, mariscos, soja, carne, pescado, huevo, miel). Las unidades de la receta son coherentes con la variante. Los ingredientes de una receta son JSON por nombre; no hay relación con la tabla `ingredients`.
- **Dietas KETO y PALEO**: el dominio no tiene una regla fija para estas dietas, así que el seed usa una propia. **Es una regla del seed sintético, no del dominio: la app no la aplica al generar planes.**
  - KETO: ≤ 10 g de carbohidratos por porción en cada receta (≤ 40 g/día con 4 comidas), sin granos, sin azúcar ni frutas dulces.
  - PALEO: sin granos, lácteos, legumbres ni azúcar agregado.
  - Hay al menos 7 recetas compatibles distintas por tipo de comida para cada una.
- **Adherencia masiva**: 250 usuarios activos × 20 marcas (14 completadas, 4 omitidas, 2 sin registrar explícito). El resto de las comidas no tiene marca. Nunca hay marcas en fechas futuras.
- **Lista de compras masiva**: un check por plan pasado, con claves reales de la lista de compras.

## Inventario de modelos

El esquema define **14 modelos** y los 14 están en la tabla. No hay tablas puente: los ingredientes de una receta son JSON y las categorías son un array de enum. Tampoco hay modelos de autenticación ni seguridad (sin sesiones, tokens ni reset): la única credencial es `User.passwordHash`.

`S` = semanas distintas en que se corrió la carga. `K` = ítems de la lista de compras del plan actual de 00001 en esa semana. `M` = marcas de la semana actual de 00001, solo de días estrictamente anteriores al de la corrida. La columna "base" son las filas de la parte base del seed, que no cuentan para la cuota.

| # | Modelo | Clase | Sintético esperado | Base | Justificación |
|---|---|---|---|---|---|
| 1 | User | cuota | 5000 | 3 | — |
| 2 | NutritionProfile | cuota (1:1) | 5000 | 3 | combinaciones de objetivo, dieta, restricciones y tiempo de cocción |
| 3 | Ingredient | cuota (catálogo) | 5000 | 2 | 63 curados + 4937 combinatorios |
| 4 | Recipe | cuota (catálogo global) | 5000 | 1 | sin dueño: visibles para todos los usuarios de la base |
| 5 | MealPlan | cuota | 5000 + S | 3 | 1 plan pasado por usuario + 1 por semana corrida para 00001 |
| 6 | MealPlanDay | dependiente | 35.000 + 7·S | 21 | 7 por plan: supera 5000 por cardinalidad |
| 7 | PlannedMeal | dependiente | 140.000 + 28·S | 42 | 4 por día: supera 5000 por cardinalidad |
| 8 | MealCompletion | cuota | 5000 + M | 0 | 250 × 20 en planes pasados + marcas de 00001 |
| 9 | ShoppingItemCheck | cuota | 5000 + ΣK | 0 | 1 por plan pasado + los ítems de 00001 en cada semana corrida |
| 10 | GenerationRun | excepción (IA) | 0 | 0 | no se fabrican ejecuciones de IA |
| 11 | KpiHttpEvent | excepción (telemetría) | 0 | 0 | no se fabrican eventos |
| 12 | KpiDependencyEvent | excepción (telemetría) | 0 | 0 | no se fabrican eventos |
| 13 | KpiHealthSample | excepción (telemetría) | 0 | 0 | no se fabrican muestras |
| 14 | KpiPublication | excepción (publicaciones) | 0 | 0 | no se fabrican publicaciones |

Las tablas `_prisma_migrations` (control de Prisma), `kpi_snapshot` y `recipe_ingredients` (eliminadas por migraciones posteriores) no se tocan.

## Reejecutar

- Cada fila tiene un ID determinístico. El seed inserta solo lo que falta (`createMany` con `skipDuplicates`), **nunca actualiza ni borra filas sintéticas** y nunca hace limpieza global de tablas.
- Después de cada fase verifica que las claves únicas (email, nombre de ingrediente, etc.) apunten al ID esperado y que estén todos los IDs. `skipDuplicates` no avisa de conflictos, así que sin esta verificación un conflicto pasaría en silencio.
- **Misma semana y mismo día**: la segunda corrida suma 0 filas sintéticas en todas las tablas (criterio 3 del ticket).
- **Otro día de la misma semana**: solo crecen las marcas de 00001, por los días que ya quedaron en el pasado.
- **Otra semana**: el crecimiento es exactamente +1 MealPlan, +7 MealPlanDay, +28 PlannedMeal, +K ShoppingItemCheck y las marcas nuevas, todo de 00001.
- La parte base, como siempre, borra y recrea el plan de la semana de `usuario.prueba1–3`. Sus conteos se mantienen y sus IDs cambian.

## Cuenta de recorrido

`demo.seed.00001@nutria.test`, con la contraseña definida en `SEED_DEMO_PASSWORD`. Perfil: objetivo mantener, dieta sin restricciones (ALL), tiempo de cocción estándar.

- **Perfil → recetas → plan de 7 días → lista de compras → adherencia**: el plan de la semana actual usa solo recetas del catálogo curado. Tiene un plan pasado (semana del 2026-01-05), al que se llega navegando semanas en la lista de compras.
- **Marcas de la semana actual.** Patrón fijo por día y comida. Solo se crean para días **estrictamente anteriores** al día de la corrida, en hora de Buenos Aires; hoy y los días futuros quedan siempre sin registrar.

| Día | Desayuno | Almuerzo | Merienda | Cena |
|---|---|---|---|---|
| Lunes | completada | completada | omitida | sin registrar |
| Martes | completada | sin registrar (explícito) | completada | sin registrar |
| Miércoles | completada | omitida | sin registrar | sin registrar |
| Jueves | completada | completada | sin registrar | omitida |
| Viernes | omitida | completada | completada | sin registrar |
| Sábado | completada | sin registrar | sin registrar (explícito) | sin registrar |
| Domingo | completada | completada | sin registrar | sin registrar |

"Sin registrar (explícito)" es una marca `NOT_LOGGED`; las otras celdas "sin registrar" no tienen fila. La app muestra las dos igual.

## KPIs en la base demo

- **`adherence_rate`** cuenta las comidas de planes vigentes cuya fecha es la fecha de reporte, sumando todos los usuarios de la base.
  - Los planes masivos están en semanas pasadas, así que **aportan 0**.
  - En la base demo el valor refleja solo las comidas del día de reporte de **00001 (4) y de `usuario.prueba1–3` (2 cada uno, sin marcas)**. **No es un valor real** y no debe publicarse como tal.
- **`manual_recipes_count`** e **`initial_plans_count`** no cuentan datos sintéticos: las recetas tienen `createdAt` fijo en el pasado y no hay GenerationRun.
- Por esto la carga va en una base dedicada (`nutria_seed_demo`), separada de la cohorte QA de NUT-105.

## Fallos y recuperación

- Cada lote es una sola inserción: se escribe entero o no se escribe.
- Si una fase falla, el seed sale con código 1 e informa la fase y el lote, por ejemplo `Fase meals (lote 2): falló la escritura. Reejecutar el seed retoma la carga.` **Volver a correrlo retoma** desde lo que falta, sin duplicar.
- Si falla una lectura de verificación, informa la fase con `read_failed`, sin el texto del error original.
- **La semana actual de 00001 es una fase aparte**, después de verificar la carga masiva.
  - Si falla, la carga masiva queda completa. El seed sale con código 1 e imprime `carga masiva OK, current-week FALLÓ`, nunca un éxito total.
  - Caso típico: 00001 ya tiene en esa semana un plan actual creado desde la app. El mensaje lo explica: "usá ese plan o corré el seed en otra base". No se borra ni se modifica ningún dato.

## Limitaciones conocidas

- **Recetas globales**: `Recipe` no tiene dueño. En la base demo, los planes nuevos de cualquier usuario pueden usar recetas sintéticas.
- **Imágenes**: las recetas no tienen imagen. Si alguien guarda desde la app un plan con recetas del seed, la app busca imagen en Unsplash para esas recetas, una vez por título. Si la base demo no tiene `UNSPLASH_ACCESS_KEY`, la búsqueda se saltea.
- **Constantes en el build**: las constantes de convención (emails, códigos de ID) viven en `src/prisma/seed-data.ts` y llegan a `dist/`. El generador, el loader y el guard no llegan (se verifica con un texto centinela).
- **Semana de la parte base**: la parte base calcula su lunes en UTC, como siempre. La parte sintética lo calcula en hora de Buenos Aires.

## Evidencia de las corridas

Corridas reales del 2026-11-11 (miércoles, semana del 2026-11-09). **Los datos cargados son sintéticos.**

| Dato | Valor |
|---|---|
| Commit probado | `d4ac318` (base `origin/main` `d74a27d`), más este README |
| Ambiente | Postgres local: contenedor Docker `nutria-postgres` (`postgres:16-alpine`, puerto 5433), base dedicada `nutria_seed_demo`, vacía y con las 15 migraciones aplicadas |
| Comando | el de [Cómo correrlo](#cómo-correrlo), con `DATABASE_URL`, `DIRECT_URL` y `DATABASE_URL_UNPOOLED` apuntando a la misma base; allowlist solo localhost; sin secretos en el repo |
| Volumen | `SEED_SYNTHETIC_USERS` y `SEED_BATCH_SIZE` por defecto (5000 y 1000) |
| Type-check | `node node_modules/typescript/bin/tsc --noEmit -p apps/api/tsconfig.json` (TypeScript 6.0.3 del repo, desde la raíz) → 0 errores. Incluye `prisma/synthetic/*` |
| Tests | `npx jest src/prisma` en verde; suite completa de la API: 141 suites y 2044 tests en verde (13 suites de integración salteadas por falta de base); integración del seed contra Postgres local: 5/5 |
| Build | `pnpm --filter api run build` limpio; el texto centinela del generador no aparece en `dist/` |

### Corridas

| | Corrida 1 | Corrida 2 |
|---|---|---|
| Hora (Buenos Aires) | 19:22 | 19:31 |
| Duración total (`Measure-Command`) | 166,1 s | 87,9 s |
| Duración de la carga sintética | 144,3 s | 68,9 s |
| Exit code | 0 | 0 |
| Resumen | `carga masiva OK, current-week OK` (6 marcas y 42 ítems de compra de 00001) | igual |
| Tamaño de la base antes | 8519 kB (8.723.479 bytes) | 98 MB (102.939.671 bytes) |
| Tamaño de la base después | 98 MB (102.939.671 bytes) | 98 MB (102.947.863 bytes) |

La segunda corrida es más rápida porque no inserta nada: solo verifica. La base crece 8 kB, que corresponden al plan de `usuario.prueba1–3`, borrado y recreado por la parte base.

### Conteos (total de la tabla = sintético + base)

| Tabla | Esperado (S=1) | Corrida 1 | Corrida 2 |
|---|---|---|---|
| users | 5003 | 5003 | 5003 |
| nutrition_profiles | 5003 | 5003 | 5003 |
| ingredients | 5002 | 5002 | 5002 |
| recipes | 5001 | 5001 | 5001 |
| meal_plans | 5004 | 5004 | 5004 |
| meal_plan_days | 35.028 | 35.028 | 35.028 |
| planned_meals | 140.070 | 140.070 | 140.070 |
| meal_completions | 5006 (5000 + M=6) | 5006 | 5006 |
| shopping_item_checks | 5042 (5000 + K=42) | 5042 | 5042 |
| generation_runs y tablas KPI | 0 | 0 | 0 |

### Integridad (consultas de solo lectura después de cada corrida)

| Chequeo | Corrida 1 | Corrida 2 |
|---|---|---|
| Planes sintéticos que no tienen 7 días × 4 comidas | 0 | 0 |
| Marcas con snapshot que no coincide con su comida | 0 | 0 |
| Marcas en el día de la corrida o en días futuros | 0 | 0 |
| Usuarios con hash bcrypt (pueden iniciar sesión) | 4 (00001 + `usuario.prueba1–3`) | 4 |
| Estados de las marcas | COMPLETED 3504, SKIPPED 1001, NOT_LOGGED 501 | igual |

Las relaciones sin huérfanos las garantizan las claves foráneas de la base. El test de integración las comprueba también con consultas explícitas.
