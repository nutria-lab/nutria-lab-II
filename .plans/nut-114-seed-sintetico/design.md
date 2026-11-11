# NUT-114 — Diseño: seeder sintético a 5000 filas por tabla

Generado: 2026-11-11 (designer backend). Fuente de verdad: el plan aprobado por la usuaria para NUT-114 ("Actualizar script de mocking de datos a 5000 filas por tabla (las puentes no cuentan)"). Este documento no nombra archivos del repo a propósito; el explorer los ubica en `plan.md`.

---

## 1. Contexto y alcance

**Objetivo.** Poblar una base aislada con datos sintéticos, coherentes, determinísticos y reproducibles, para recorrer y demostrar NutrIA sin cargar registros a mano: 5000 filas sintéticas por cada tabla de negocio con cuota, sin fabricar datos técnicos, de IA ni de telemetría.

**Contexto verificado en el código actual.**
- Existe un único mecanismo de carga: el **seeder base** (entrypoint de seed de Prisma más un módulo de datos base con constantes). Se amplía; no se crea un segundo mecanismo.
- El esquema Prisma es multi-archivo y define **14 modelos**. Todos los `@id` son `String` UUID (los de KPI son `@db.Uuid`).
- No hay tablas puente en el esquema vigente: los ingredientes de una receta son JSON con `name` (sin FK a Ingredient) y las categorías son un array de enum.
- No hay modelos de autenticación ni seguridad (sin sesiones, refresh tokens, reset ni verificación). La autenticación es JWT sin estado y la única credencial es `User.passwordHash`.
- `User` no tiene rol ni campo de permisos. `Recipe` no tiene dueño ni autor: es un catálogo global visible para todos los usuarios de la base, y el composer de planes lo reutiliza al generar.
- La FK `MealPlan.generationRunId` y `Recipe.generationRunId` es opcional (`onDelete: SetNull`).
- La app lee "el plan actual" **siempre por semana** (`userId`, `startDate` = lunes, `isCurrent = true`), con el lunes calculado en hora de Buenos Aires. Adherencia y lista de compras también filtran por semana.
- El KPI `adherence_rate` (ADR-0004) suma, en toda la población del ambiente, las comidas de planes vigentes cuya fecha civil coincide con la fecha de reporte: `100 * C / N`, donde C son las comidas COMPLETED con snapshots vigentes y N todas las elegibles. Solo calcula cuando la fecha de reporte es la del último cierre automático de Argentina (21:00); antes del cierre del día, esa fecha es la de ayer. `initial_plans_count` cuenta planes con GenerationRun `MEAL_PLAN_INITIAL` creados en la ventana, y `manual_recipes_count`, recetas MANUAL creadas en la ventana.
- Recetas con la clave `image: null` no disparan búsqueda en Unsplash al listar ni al generar; el seeder nunca pasa por los servicios que buscan imágenes.
- El seed no corre en ningún pipeline ni deploy: CI no lo invoca, los workflows KPI solo generan el cliente y corren scripts `kpi:*`, y el build de Vercel corre `prisma migrate deploy`, que no ejecuta el seed. Solo se invoca a mano.

**Dentro del alcance.** Generador sintético puro; catálogo curado de ingredientes; loader por fases con verificación; guard de destino; constantes de convención en el módulo de datos base; integración en el seeder base; documentación del seeder sintético con evidencia; tests.

**Fuera del alcance.** Cambios al esquema o migraciones; endpoints nuevos; cambios de contratos FE/BE; cambios en servicios de planes o imágenes; fabricar GenerationRun, eventos/muestras/publicaciones KPI; consultar la API de Neon; escribir en Linear sin pedirlo.

**Alcance horario.** Estimado 6–8 h contra 2 h autorizadas: se escala al PM y no se implementa hasta la confirmación de la usuaria.

---

## 2. Registro de decisiones

**D1 — Ampliar el seeder base, no crear otro.** La parte base (usuarios `usuario.prueba1–3@nutria.com`, receta base de pollo con ID fijo, 2 ingredientes base) queda igual. La parte sintética es opcional y corre después.

**D2 — Aislamiento de KPIs (NUT-105).** Los 5000 planes sintéticos van en **semanas pasadas fijas** y las recetas tienen `createdAt` **pasado y fijo**. Los planes masivos no tienen ningún día en la fecha de reporte, así que aportan 0 comidas a `adherence_rate`. Las recetas tienen `createdAt` fuera de la ventana, así que no suman a `manual_recipes_count`, y como no hay GenerationRun tampoco suman a `initial_plans_count`. La cuenta de recorrido 00001 recibe además un plan en la semana actual, y el seeder base mantiene el plan de la semana de `usuario.prueba1–3` (2 comidas por día, sin marcas). En la base donde se cargue, `adherence_rate` refleja **solo las comidas del día de reporte de 00001 (4) y de `usuario.prueba1–3` (6)** y no es un valor real. Por eso la carga se ejecuta en una **base aislada, distinta de la de NUT-105**.

**D3 — Ingredient: 5000 sintéticos más los 2 base.** Catálogo curado real (~60, con etiquetas de dieta y alérgenos) más nombres combinatorios únicos y determinísticos (base × presentación × tamaño, por ejemplo "Tomate perita en lata 400 g"). La cuenta 00001 usa solo el catálogo curado; las recetas masivas usan los combinatorios. Los 2 base no cuentan para la cuota.

**D4 — Idempotencia por insert-or-skip.** `createMany({ skipDuplicates: true })` sobre IDs determinísticos: inserta lo que falta, nunca actualiza lo existente (así `PlannedMeal.updatedAt` no se mueve y los snapshots de adherencia siguen valiendo) y nunca hace `deleteMany` sobre datos sintéticos. Como `skipDuplicates` oculta conflictos, cada fase verifica IDs esperados y claves únicas → ID esperado.

**D5 — Convención de identidad.** Emails `demo.seed.NNNNN@nutria.test` (00001–05000), nombres "Demo Sintético NNNNN", cuenta de recorrido 00001, IDs `5eedTTTT-0000-4000-8000-NNNNNNNNNNNN`. Prefijos reservados que el generador nunca usa: `usuario.prueba*` y `qa.*`.

**D6 — Sin credenciales utilizables fabricadas.** Solo 00001 recibe un hash bcrypt de `SEED_DEMO_PASSWORD`. Los otros 4999 llevan el literal `!synthetic-no-login`, que no es un hash bcrypt: la comparación del login nunca lo acepta.

**D7 — Guard basado en el destino, antes de cualquier escritura (incluida la parte base).** Allowlist explícita de `host/base`; localhost siempre permitido; variables de producción como cinturón extra. Ver sección 8.

**D8 — Lunes en hora de Buenos Aires.** El lunes de la semana actual se calcula desde el helper de fecha de Buenos Aires del módulo de adherencia, igual que el front, no en UTC. Una corrida un lunes entre 00:00 y 03:00 (hora argentina) no cae en la semana anterior.

**D9 — Fase current-week separada de la carga masiva.** La carga masiva (5000 planes pasados y dependientes) se carga y verifica primero y no depende de current-week. Si current-week falla, la masiva queda completa y verificada.

**D10 — Reutilizar lógica de dominio existente, sin duplicarla.** Mapper de nutrición de comidas (receta → `nutritionalValues`), transformación de lista de compras (para `itemKey` válidos), orden de comidas de la asignación semanal (B/L/S/D) y helper de fecha de Buenos Aires.

**D11 — El generador queda fuera del artefacto de build.** El generador, el loader, el catálogo y el guard viven fuera del árbol fuente compilado, junto al seeder. En el módulo de datos base (que sí se compila) van solo las constantes de convención. Se verifica buscando un texto centinela del generador en el build.

**D12 — Sin migraciones.** No se modifica el esquema ni se crean migraciones; el índice parcial y las FK existentes se respetan.

**D13 — Excepciones informadas al PM.** GenerationRun y las 4 tablas KPI quedan en 0 y se informan antes de cerrar el ticket.

---

## 3. Arquitectura

Componentes (conceptuales):

| Componente | Responsabilidad | Pureza |
|---|---|---|
| **Constantes de convención** (en el módulo de datos base) | dominio de email, formato de email y nombre, cuenta de recorrido, tabla de códigos `TTTT`, función `synthId(table, n)` | pura |
| **Catálogo curado** | ~60 ingredientes reales con dieta y alérgenos | datos |
| **Generador sintético** | constructores puros y determinísticos de cada entidad; nombres de ingredientes únicos; compatibilidad dieta/restricciones; planes 7×4; patrones de marcas y checks; recibe `now` inyectado | pura |
| **Guard de destino** | `assertSeedTarget(env)`: valida destinos y flags, enmascara logs; se llama al inicio, antes de crear `Pool` y `PrismaClient` | pura |
| **Loader por fases** | escribe por lotes con `createMany skipDuplicates`, verifica cada fase, lanza `SeedPhaseError(phase, batch\|code, muestra?)`, ejecuta verify masiva, current-week y su verify, imprime conteos y duración | I/O |
| **Integración en el seeder base** | guard → base → (si `SEED_SYNTHETIC=true`) loader; mapea errores a exit code 1 | I/O |
| **Documentación del seeder sintético** | variables, comando, conteos esperados por fórmula, comportamiento al reejecutar, base aislada, visibilidad global de recetas, aclaración de que `adherence_rate` en la base demo refleja solo a 00001 y a `usuario.prueba1–3` y no es un valor real, commit base probado, evidencia de corridas | doc |

Parámetros de volumen: `SEED_SYNTHETIC_USERS` (por defecto 5000, máximo 5000; escala todo lo demás) y `SEED_BATCH_SIZE` (por defecto 1000).

### 3.1 Fases

```
guard
 → base
 → ingredients → users → profiles → recipes → plans → days → meals
 → completions → shopping-checks
 → verify (carga masiva)
 → current-week: plan → días → comidas → marcas → checks (solo 00001)
 → verify (current-week)
```

- Cada lote es un `createMany`. Un fallo lanza `SeedPhaseError(phase, batch)` y sale con código 1: "falló fase X lote N; reejecutar retoma".
- Un fallo en la carga masiva impide ejecutar current-week.
- Un fallo en current-week no revierte ni bloquea la masiva; se imprime "carga masiva OK, current-week FALLÓ" y exit 1, nunca éxito total.
- Al final se imprimen conteos por tabla y duración, sin secretos.

---

## 4. Flujos

### F1 — Carga masiva (primera corrida)
1. El guard valida destino y flags; si bloquea, termina sin crear `Pool` ni cliente.
2. Parte base igual que siempre.
3. Por cada fase masiva: generar filas determinísticas → insertar por lotes → consultar IDs esperados (`findMany` por lotes con `where: { id: { in } }`) → comparar claves únicas → seguir o fallar.
4. Verify masiva: conteos totales contra fórmulas, cada plan con 7×4 comidas, sin huérfanos.

### F2 — Reejecución en la misma semana y el mismo día civil
Todas las inserciones se saltean; las verificaciones pasan; cada tabla suma 0.

### F3 — Reejecución otro día de la misma semana
Solo crece MealCompletion: las marcas de 00001 de los días nuevos que ya quedaron estrictamente en el pasado.

### F4 — Reejecución en otra semana
Crecimiento exacto, solo para 00001: +1 MealPlan, +7 MealPlanDay, +28 PlannedMeal, +K ShoppingItemCheck y +marcas de días pasados de esa semana.

### F5 — Current-week de 00001
1. Calcular el lunes actual en hora de Buenos Aires desde `now`.
2. Insertar el plan con ID derivado del lunes (`isCurrent=true`); verificar que el plan actual de 00001 para esa semana tenga ese ID.
3. Insertar 7 días y 28 comidas; las comidas usan solo recetas del catálogo curado compatibles con su perfil.
4. Releer de la base `id`, `recipeId` y `updatedAt` de cada comida.
5. Marcas: insert-or-skip solo para días **estrictamente anteriores** a hoy (`dateInBuenosAires(now)`), con patrón fijo por día (por ejemplo lunes COMPLETED, COMPLETED, SKIPPED, sin fila; martes COMPLETED, NOT_LOGGED, COMPLETED, sin fila). Snapshots `recipeIdSnapshot`/`mealUpdatedAtSnapshot` tomados de lo releído. Nunca hoy ni futuro; nunca se actualizan marcas existentes.
6. Checks: aplicar la transformación de lista de compras al plan releído y crear un `ShoppingItemCheck` por ítem, alternando `checked` true/false, con IDs derivados del lunes. Insert-or-skip con verificación clave → ID.
7. Verify current-week.

### F6 — Conflicto de plan actual en la semana
Si 00001 ya tiene un plan `isCurrent` en la semana actual con otro ID (por ejemplo generado desde la app), el índice parcial hace que `skipDuplicates` lo saltee en silencio. La verificación lo detecta y falla con `SeedPhaseError('plans', 'week_current_conflict')` sin tocar ese plan ni crear dependientes. Mensaje:

> "current-week: demo.seed.00001 ya tiene un plan actual creado fuera del seed para la semana YYYY-MM-DD. La carga masiva quedó completa y verificada. Para el recorrido, usá ese plan o corré el seed en otra base. No se borró ni modificó ningún dato."

Los planes pasados de 00001 (con marcas y checks) siguen disponibles navegando semanas.

### F7 — Conflicto de email o clave única
Si `demo.seed.NNNNN@nutria.test` existe con otro ID, la fase users falla con `email_id_conflict` sin tocar ese usuario ni seguir con dependientes. Lo mismo para `Ingredient.name`, `NutritionProfile.userId`, `ShoppingItemCheck(userId, planId, itemKey)` y `MealCompletion.plannedMealId` cuando la clave apunta a otro ID.

### F8 — Fallo transitorio y recuperación
Un fallo en un lote reporta fase y lote; la corrida siguiente retoma, inserta lo que falta y completa.

---

## 5. Historias de usuario

- **H1.** Como integrante del equipo, quiero una base demo con 5000 usuarios, perfiles, recetas, planes, marcas y checks sintéticos, para mostrar la app con volumen realista sin cargar datos a mano.
- **H2.** Como demo, quiero entrar con `demo.seed.00001@nutria.test` y recorrer perfil → recetas → plan de 7 días de la semana actual → lista de compras → adherencia (completadas, omitidas y sin registrar).
- **H3.** Como responsable de datos, quiero que el seeder sea idempotente y recuperable, para reejecutarlo sin duplicar ni borrar nada.
- **H4.** Como responsable de seguridad, quiero que el seeder se niegue a escribir en cualquier destino no autorizado explícitamente, incluida producción, y que no fabrique credenciales utilizables.
- **H5.** Como responsable de KPIs, quiero que los datos sintéticos masivos no aporten al KPI del día de reporte, y que lo único que aparezca en él sea la cuenta de recorrido, documentado como valor no real.

---

## 6. Criterios de aceptación

1. Con `SEED_SYNTHETIC=true` sobre un destino permitido, cada tabla con cuota tiene exactamente el conteo sintético esperado de la sección 9.
2. Las 5 excepciones quedan en 0 filas sintéticas; no hay tablas puente.
3. La segunda corrida en la misma semana y el mismo día civil suma 0 en todas las tablas. Entre días y semanas el crecimiento es exactamente el de F3/F4.
4. Ninguna corrida ejecuta `deleteMany` sobre datos sintéticos ni actualiza filas existentes; los usuarios base, la receta base y los ingredientes base quedan intactos.
5. Toda falla informa fase y lote o código (`missing_ids`, `email_id_conflict`, `week_current_conflict`), sale con código 1 y nunca imprime éxito total.
6. El guard bloquea antes de crear `Pool`/cliente cualquier URL definida fuera de la allowlist, cualquier variable de producción, y la parte sintética sin confirmación o sin contraseña demo.
7. Solo 00001 puede iniciar sesión; los otros 4999 reciben 401.
8. Cada comida tiene la nutrición de su receta según el mapper de nutrición; cada receta asignada es compatible con la dieta y las restricciones del perfil; cada `itemKey` es un hash hex de 64 caracteres perteneciente a la lista calculada.
9. Ninguna marca cae en hoy ni en un día futuro (hora de Buenos Aires); hay mezcla de COMPLETED/SKIPPED/NOT_LOGGED/sin fila.
10. Con el colector de KPIs de datos real, `now` fijo y fecha de reporte fija, los planes masivos aportan 0 comidas a `adherence_rate`. Con fecha de reporte = hoy se cuentan las 4 comidas de 00001 de hoy sin marcar (0/4). Con fecha de reporte = ayer se cuentan sus 4 comidas de ayer con las marcas del seed (2/4, según el patrón fijo del día). `manual_recipes_count` e `initial_plans_count` no cuentan datos sintéticos.
11. El texto centinela del generador no aparece en el artefacto de build.
12. Logs y errores nunca contienen usuario, contraseña ni la URL completa.

---

## 7. Convenciones

### 7.1 IDs
Formato: `5eedTTTT-0000-4000-8000-NNNNNNNNNNNN` (12 dígitos decimales, válidos como hex; versión 4 y variante 8 en sus posiciones). Generado por `synthId(table, n)`.

| TTTT | Tabla |
|---|---|
| 0001 | users |
| 0002 | recipes |
| 0003 | meal plans |
| 0004 | days |
| 0005 | meals |
| 0006 | profiles |
| 0007 | ingredients |
| 0008 | completions |
| 0009 | shopping checks |

**IDs de la semana actual** (00001; `YYYYMMDD` = lunes en Buenos Aires; `D` = día 0–6; `M` = comida 0–3; `III` = índice de ítem):
- Plan (0003): `…-9YYYYMMDD000`
- Días (0004): `…-9YYYYMMDD00D`
- Comidas (0005): `…-9YYYYMMDD0DM`
- Marcas (0008): `…-9YYYYMMDD0DM`
- Checks (0009): `…-9YYYYMMDDIII`

El prefijo `9` del segmento final separa el espacio de la semana actual del espacio masivo. Ningún ID choca con el ID fijo de la receta base.

### 7.2 Emails y nombres
- Email: `demo.seed.NNNNN@nutria.test`, `NNNNN` = 00001–05000.
- Nombre: "Demo Sintético NNNNN".
- Cuenta de recorrido: 00001.
- Reservados (nunca generados): `usuario.prueba*`, `qa.*`.

### 7.3 Credenciales
- 00001: hash bcrypt de `SEED_DEMO_PASSWORD`, calculado una sola vez por corrida, nunca logueado.
- Resto: `!synthetic-no-login` (no es bcrypt; la comparación devuelve false o lanza y el login responde 401).
- El objeto User generado tiene exactamente `id`, `email`, `name`, `passwordHash`; ante un futuro campo de rol o permisos el seeder no lo setea y aplica el default.

### 7.4 Nombres de ingredientes
- Normalización estricta de comparación: NFKC → NFD sin diacríticos → minúsculas → trim → espacios colapsados. Es más estricta que el `@unique` exacto de la base y que la normalización de agrupado de la lista de compras (NFKC, trim, espacios, minúsculas `es`).
- El conjunto excluido se arma con los nombres de los 2 ingredientes base **importados** de las constantes base (no copiados).
- Los 5000 sintéticos son únicos entre sí y contra los base bajo esa normalización; si el catálogo curado inyectado contiene un nombre que colisiona (por ejemplo `"pechuga de pollo "`), el generador falla.

### 7.5 Fechas
- Planes pasados en lunes fijos desde 2026-01-05, rotando 40 semanas (todas anteriores a hoy), días lunes → domingo coherentes. Cada usuario tiene un `startDate` distinto entre sus planes.
- Recetas con `createdAt` pasado y fijo.
- `now` inyectable en generador y loader.

---

## 8. Guard de destino

Función pura `assertSeedTarget(env)`, invocada al principio del seeder, antes de crear `Pool` y `PrismaClient`.

1. **URLs evaluadas:** `DATABASE_URL`, y además `DATABASE_URL_UNPOOLED` y `DIRECT_URL` si están definidas (la configuración de Prisma CLI prioriza la unpooled). Cada una se reduce a `host/base`.
2. **Normalización:** el sufijo `-pooler` del host de Neon se elimina, para que la variante pooled y la unpooled del mismo endpoint coincidan.
3. **Allowlist:** `localhost`, `127.0.0.1` y `::1` con cualquier base siempre permitidos; además los destinos exactos `host/base` listados en `SEED_ALLOWED_TARGETS` (separados por comas; solo host y base, nunca usuario ni contraseña). Con `SEED_ALLOWED_TARGETS` vacía solo se permite localhost. **Cualquier URL definida fuera de la allowlist bloquea.**
4. **Limitación Neon:** el host (`ep-<palabras>-<id>[-pooler].<región>.aws.neon.tech`) no contiene el nombre de la rama y la base suele ser `neondb`; por eso la allowlist es por endpoint exacto. Validar el nombre de la rama requeriría la API de Neon, fuera de alcance.
5. **Cinturón extra:** bloquea si `NODE_ENV`, `KPI_ENV` o `VERCEL_ENV` valen `production`, aun con localhost. No reemplaza la allowlist.
6. **Parte sintética:** solo con `SEED_SYNTHETIC=true`, y exige `SEED_CONFIRM_TARGET=<host>/<base>` igual al destino ya permitido, y `SEED_DEMO_PASSWORD` definida.
7. **Logs:** solo host enmascarado (por ejemplo `ep-***-1234…neon.tech`) y nombre de base; nunca la URL, usuario ni contraseña, tampoco en mensajes de error.
8. **Impacto en la parte base:** correr el seed base contra un Neon remoto pasa a exigir `SEED_ALLOWED_TARGETS`. No rompe ningún deploy (el seed no corre en pipelines). Se documenta.

Las variables `DATABASE_URL`, `SEED_ALLOWED_TARGETS`, `SEED_CONFIRM_TARGET` y `SEED_DEMO_PASSWORD` las define la usuaria en su entorno: no se escriben en archivos, no se imprimen y no se piden.

---

## 9. Estrategia Prisma / base de datos

### 9.1 Sin migraciones
No cambia el esquema. Las inserciones respetan las FK, enums (tomados del cliente generado, sin valores libres) y el índice único parcial existente.

### 9.2 Escritura e idempotencia
- `createMany({ data, skipDuplicates: true })` por lotes de `SEED_BATCH_SIZE`.
- Nunca `update`, `upsert` ni `deleteMany` en la parte sintética.
- **Verificación por fase:** después de cada fase, `findMany` por lotes de los IDs esperados. Faltante → `SeedPhaseError(phase, 'missing_ids', muestra)` antes de la fase siguiente. Claves únicas no-ID comparadas contra el ID esperado: `User.email`, `Ingredient.name`, `NutritionProfile.userId`, `ShoppingItemCheck(userId, planId, itemKey)`, `MealCompletion.plannedMealId`.
- **Verify masiva y verify current-week:** conteos totales contra fórmulas (S se calcula contando los planes de 00001 con ID de semana actual), 7×4 comidas por plan, sin huérfanos. Si algo no cuadra, falla.

### 9.3 Un plan actual por usuario y semana
El índice único parcial `meal_plans_user_week_current_key` sobre `("userId","startDate") WHERE "isCurrent" = true` permite un plan actual por usuario **por semana**; no hay regla de un único plan activo en total. Todos los planes sintéticos son `isCurrent=true` con `startDate` distinto por usuario; para 00001 el plan pasado y los de cada semana corrida tienen lunes distintos. Un plan ajeno en la misma semana se detecta como `week_current_conflict` (F6).

### 9.4 Aislamiento de KPIs
- Planes masivos en semanas pasadas fijas (la última termina el domingo 2026-10-11) → ningún día coincide con la fecha de reporte → aportan 0 comidas a `adherence_rate`.
- Recetas con `createdAt` pasado y fijo → no afectan `manual_recipes_count`. Sin GenerationRun → no afectan `initial_plans_count`.
- Solo 00001 tiene plan en la semana actual → aporta sus 4 comidas del día de reporte. Con fecha de reporte = hoy quedan sin marcar, porque nunca se marca hoy. Con fecha de reporte = ayer llevan las marcas del seed. El seeder base suma además las 2 comidas por día, sin marcas, de cada `usuario.prueba1–3`. En la base demo, `adherence_rate` refleja solo a 00001 y a esos 3 usuarios y no es un valor real; la documentación lo aclara. El test de integración carga solo la parte sintética, por eso ahí N = 4. La carga va en una base aislada distinta de la de NUT-105.

### 9.5 Snapshots de adherencia
`recipeIdSnapshot` y `mealUpdatedAtSnapshot` se arman con `id`, `recipeId` y `updatedAt` releídos de la base después de insertar las comidas; nunca se heredan entre recetas. Como no se actualizan comidas, las marcas siguen siendo válidas en corridas posteriores.

### 9.6 Volumen en Neon
- Estimación a validar: ~200k filas, 100–200 MB con índices.
- Evidencia antes y después de cada corrida: `pg_size_pretty(pg_database_size(current_database()))` y `pg_total_relation_size` de `planned_meals`, `meal_plan_days` y `recipes`.
- Confirmar el límite del plan en la consola de Neon antes de correr; si la estimación supera el 70 % del límite, frenar y avisar.

### 9.7 Inventario de modelos

`S` = semanas distintas en las que se corrió la carga. `K` = ítems de la lista de compras del plan actual de 00001 en esa semana (salen de la transformación de lista de compras; determinísticos para cada lunes). `M` = marcas creadas para la semana actual de 00001 en todas las corridas (0 ≤ M ≤ 24 por semana).

| # | Modelo | Clase | Esperado sintético | Justificación |
|---|---|---|---|---|
| 1 | User | cuota | 5000 | sin rol ni permisos; solo 00001 con bcrypt usable, resto `!synthetic-no-login` |
| 2 | NutritionProfile | cuota (1:1 User) | 5000 | combinaciones rotadas de goal × diet × restricciones × tiempo de cocción |
| 3 | Ingredient | cuota (catálogo global) | 5000 (+2 base fuera de cuota) | curado (~60) + combinatorio único bajo normalización estricta; sin FK desde Recipe |
| 4 | Recipe | cuota (catálogo global, sin dueño) | 5000 | MANUAL, `createdAt` pasado fijo, `image: null`, categorías derivadas de sus ingredientes; visibles para todos los usuarios de la base |
| 5 | MealPlan | cuota | 5000 + S | 1 plan pasado por usuario (lunes fijos desde 2026-01-05) + 1 de semana actual de 00001 por semana corrida; todos `isCurrent=true` |
| 6 | MealPlanDay | dependiente | 35.000 + 7·S | 7 por plan |
| 7 | PlannedMeal | dependiente | 140.000 + 28·S | 4 por día (B/L/S/D) |
| 8 | MealCompletion | cuota | 5000 + M | 250 usuarios activos × 20 marcas en planes pasados (14 COMPLETED, 4 SKIPPED, 2 NOT_LOGGED; resto sin fila) + marcas de 00001 en días estrictamente pasados de cada semana corrida |
| 9 | ShoppingItemCheck | cuota | 5000 + Σ K | 1 por plan pasado + todos los ítems del plan actual de 00001 por semana corrida (mezcla true/false) |
| 10 | GenerationRun | excepción (técnica/IA) | 0 | fabricarlas falsificaría ejecuciones de IA; FK opcional |
| 11 | KpiHttpEvent | excepción (telemetría) | 0 | no se fabrican eventos |
| 12 | KpiDependencyEvent | excepción (telemetría) | 0 | no se fabrican eventos |
| 13 | KpiHealthSample | excepción (telemetría) | 0 | no se fabrican muestras |
| 14 | KpiPublication | excepción (publicaciones) | 0 | no se fabrican publicaciones aceptadas |
| — | Tablas puente | — | — | no existen: ingredientes en JSON, categorías como array de enum |
| — | Auth/seguridad | — | — | no existen modelos; la única credencial es `User.passwordHash` |
| — | `_prisma_migrations`, `kpi_snapshot`, `recipe_ingredients` | técnica / eliminadas | no se tocan | la primera es control de Prisma; las otras dos fueron eliminadas por migraciones posteriores |

Cobertura: 14 modelos en el esquema = 14 filas (9 con datos sintéticos, 5 excepciones).

---

## 10. Tests requeridos (TDD: primero en rojo)

Ubicación: junto a los tests existentes del módulo de seed; el test del seeder base se conserva.

### 10.1 Guard de destino (cada caso aislado, una sola variable distinta del caso permitido)
1. `NODE_ENV=development` con `DATABASE_URL` remota fuera de la allowlist → bloquea, **cero llamadas** al cliente y al `Pool`.
2. Destino permitido por allowlist con `SEED_CONFIRM_TARGET` distinto → bloquea.
3. `DATABASE_URL` permitida con `DATABASE_URL_UNPOOLED` fuera de la allowlist → bloquea.
4. `SEED_ALLOWED_TARGETS` vacía con host remoto → bloquea; con localhost → permite.
5. Variantes `-pooler` y sin pooler del mismo endpoint → mismo destino.
6. `NODE_ENV=production` con localhost → bloquea.
7. Falta `SEED_DEMO_PASSWORD` con `SEED_SYNTHETIC=true` → bloquea.
8. Mensajes de error y logs no contienen usuario, contraseña ni URL completa.
9. Sin `SEED_SYNTHETIC` y con destino permitido, la parte base se ejecuta igual que siempre.

### 10.2 Credenciales
1. `bcrypt.compare(cualquier, '!synthetic-no-login')` no autentica (false o error) y el login responde 401.
2. Solo 00001 tiene un hash bcrypt válido.

### 10.3 Generador sintético
1. IDs y emails únicos con el formato acordado.
2. Ningún ID choca con el ID fijo de la receta base ni ningún email con prefijos `usuario.prueba`/`qa.`.
3. 5000 nombres de ingrediente únicos bajo la normalización estricta.
4. Ningún nombre sintético normalizado coincide con los nombres de los 2 ingredientes base importados de las constantes base.
5. Caso aislado: catálogo curado inyectado con un solo ingrediente `"pechuga de pollo "` → el generador falla.
6. Planes 7×4 completos en orden B/L/S/D, con fechas lunes → domingo.
7. La nutrición de cada comida es igual a la del mapper de nutrición aplicado a su receta.
8. Las recetas asignadas respetan dieta y restricciones del perfil.
9. Ninguna marca cae en fecha futura.
10. Mezcla de COMPLETED/SKIPPED/NOT_LOGGED/sin fila.
11. Las `itemKey` matchean `^[0-9a-f]{64}$` y pertenecen a la lista calculada.

### 10.4 Loader (cliente falso en memoria con semántica de `skipDuplicates`)
1. La segunda corrida da los mismos conteos.
2. Fallo inyectado en `meals` informa fase y lote; la corrida siguiente completa la carga.
3. Nunca se llama a `deleteMany` sobre datos sintéticos; los usuarios base quedan intactos.
4. Solo `demo.seed.00001` existente con otro ID (sin otros datos) → users falla con `email_id_conflict`, ningún dependiente escrito, sin mensaje de éxito.
5. `Ingredient.name` sintético existente con otro ID → ingredients falla.
6. El cliente falso descarta una fila tras `createMany` → la fase reporta `missing_ids`.
7. **Marcas de semana actual:** corrida con `now` = lunes → 0 marcas de semana actual; corrida posterior con `now` = miércoles → marcas solo para lunes y martes; tercera corrida el miércoles → suma 0; ninguna marca en miércoles o después; `updatedAt` de comidas sin cambios entre corridas.
8. **Plan actual en conflicto:** 00001 con plan `isCurrent` ajeno en la semana actual (sin otros datos) →
   - carga masiva completa: 5000 planes, 35.000 días, 140.000 comidas, 5000 marcas, 5000 checks; verify masiva pasó;
   - current-week falla con `week_current_conflict` y el mensaje accionable;
   - plan ajeno intacto (mismo `updatedAt` y mismas comidas); no se escriben días, comidas, marcas ni checks de la semana actual;
   - exit code 1, sin éxito total.
9. **Orden de fases:** fallo inyectado en current-week no revierte ni bloquea la masiva; fallo inyectado en la masiva impide ejecutar current-week.
10. **Conteos entre semanas:** corrida en semana A y luego en semana B → crecimiento exacto +1/+7/+28/+K más marcas; repetir en B suma 0.
11. **Checks de semana actual:** cada `itemKey` sale de la transformación de lista de compras del plan actual de 00001, mezcla true/false, sin duplicados en la segunda corrida.

### 10.5 Permisos
1. Los objetos User generados tienen exactamente `id`, `email`, `name`, `passwordHash`; el test falla ante cualquier clave extra.

### 10.6 Integración contra Postgres local
Siguiendo el patrón del test de integración de persistencia de adherencia: `SEED_TEST_DATABASE_URL` solo local, schema privado, volumen reducido (50 usuarios).
1. Carga dos veces con conteos estables.
2. Fallo recuperable.
3. FK sin huérfanos.
4. **KPI del día de reporte** con el colector de KPIs de datos real, `now` del seed y reloj del KPI fijos e iguales (sin depender del día real):
   - **Fecha de reporte = hoy:** `now` = miércoles 2026-11-11 22:00 en Argentina, después del cierre de las 21:00. Resultado: N = 4 (las comidas de 00001 del miércoles), C = 0 y `adherence_rate` = 0. Los planes masivos aportan 0.
   - **Fecha de reporte = ayer:** `now` = miércoles 2026-11-11 15:00 en Argentina, antes del cierre, así que la fecha de reporte es el martes 2026-11-10. Resultado: N = 4 (comidas de 00001 del martes), C = 2 (patrón fijo del martes: COMPLETED, NOT_LOGGED, COMPLETED, sin fila) y `adherence_rate` = 50. Los planes masivos aportan 0.

### 10.7 Verificación de cierre
- Tests del módulo de seed en verde, luego la suite completa de la API.
- Build de la API y búsqueda del texto centinela del generador en el artefacto (no debe aparecer).

---

## 11. Entrega por bloques (con aprobación humana entre bloques)

Reglas: sin `git add`, commit ni push por parte de agentes. Al terminar cada bloque con tests en verde se entrega `git status`, resultado de tests y un commit sugerido que referencia NUT-114, y se espera el "listo" de la usuaria. Si algo resulta inviable se avisa en lugar de cambiar el alcance.

1. **Bloque 1 — piezas puras.** Catálogo curado, generador sintético, guard de destino y constantes de convención. Tests de guard, generador, credenciales y permisos (rojo → verde).
2. **Bloque 2 — loader e integración.** Loader por fases con verificación por fase, verify masiva, current-week y su verify; integración en el seeder base. Tests de loader y current-week más integración contra Postgres local. Antes de cerrar: suite completa de la API, build y búsqueda del centinela.
3. **Bloque 3 — corrida real y evidencia.** Antes de la primera carga se confirma con la usuaria host y base (sin credenciales). Dos corridas con el comando de seed de la raíz del monorepo (no `prisma db seed`, que en Prisma 7 se configura aparte y no está configurado). La documentación del seeder sintético registra: conteos esperados y reales de ambas corridas, duración, tamaño de la base antes/después, commit probado, comando sin secretos, ambiente, cuenta demo y la aclaración de que todos los datos son sintéticos. Se entrega el texto para la descripción del PR y se piden las horas reales. No se escribe en Linear sin preguntar.

---

## 12. Riesgos

- **Alcance horario** (6–8 h vs 2 h): requiere confirmación del PM.
- **KPI en la base demo:** `adherence_rate` de esa base refleja solo las comidas del día de reporte de 00001 (4) y de `usuario.prueba1–3` (6, del seeder base). No representa uso real y no debe publicarse como tal.
- **Recetas globales:** en la base demo, los planes nuevos de cualquier usuario (incluidos `usuario.prueba1–3`) pueden usar recetas sintéticas. Mitigación: base aislada y documentación.
- **Guardado de planes desde la app:** el PUT de planes reemplaza `image` solo si es truthy, así que guardar un plan con recetas del seed busca imagen (una llamada por título único). Sin `UNSPLASH_ACCESS_KEY` la búsqueda se saltea. No se cambia (fuera de alcance).
- **Constantes en el build:** el módulo de datos base ya se compila; las constantes de convención también llegarán al build, aunque el generador no.
- **Volumen en Neon free:** ~200k filas; se confirma con el límite real y la duración medida.
- **Cambio de comportamiento del seed base remoto:** exige `SEED_ALLOWED_TARGETS`; documentado y sin impacto en deploys.
