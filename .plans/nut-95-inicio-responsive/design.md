# NUT-95 — Inicio responsive con comidas de hoy y accesos (diseño frontend)

Etapa: `frontend_designer`. Generado: 2026-10-19; actualizado: 2026-10-22. Fuente visual: Stitch proyecto `5785725448623770239`, frames Dashboard desktop `e631a85a17994a13befc190dda8c41a0` ("Dashboard - Terra Kitchen", 2560 px @2x ≈ 1280 px) y Dashboard móvil `ae8d7cb550ae4d9d84e5aea111eb93a7` ("Dashboard - Móvil", 780 px @2x ≈ 390 px). Solo lectura; no se generaron ni editaron pantallas.

## 1. Registro de decisión

| # | Decisión | Motivo |
|---|---|---|
| D1 | La ruta `/dashboard` es la pantalla de Inicio dentro del shell autenticado existente (AppLayout: Sidebar + TopBar en md+, PageHeader + BottomNavigation en mobile). No se recrea shell, navegación ni tipografía. | Reutilizar Terra; alcance aprobado. |
| D2 | La página consume un `DashboardViewModel` tipado. La tarjeta de comidas usa `CardState<T>` (`loading` / `error` / `unavailable` / `ready(data)`); el slot de progreso usa `AdherenceWidgetProps` (§16). Cada tarjeta es independiente de la otra. | Permite error parcial y estados explícitos por tarjeta. |
| D3 | No hay datos reales (pertenecen a NUT-96). La fuente de datos es un proveedor intercambiable: en desarrollo, fixtures seleccionables con `?estado=<clave>`; en producción, ambas tarjetas en "No disponible todavía". | Nunca loading infinito ni datos de ejemplo en producción. |
| D4 | Los fixtures se cargan solo en modo desarrollo de Vite (`import()` dinámico condicionado por `import.meta.env.DEV`), de modo que el bundle de producción no los contiene (verificable buscando la cadena centinela de los fixtures en el build). | Requisito "fixtures no llegan a producción". |
| D5 | El slot "Progreso semanal" es solo contenedor + estados (skeleton / error / no disponible / placeholder neutro). Nunca muestra números, porcentajes, barras ni días marcados. El contenido real es NUT-94. | Evitar adelantar la métrica de adherencia. |
| D6 | "Siguiente comida por registrar" = primer `TodayMeal` con `status === NOT_LOGGED` en el orden fijo BREAKFAST → LUNCH → SNACK → DINNER. Nunca usa la hora del reloj y nunca afirma que algo se consumió. Si alguna comida tiene estado desconocido (§16) no se resalta ninguna. | Determinismo y lenguaje no clínico. |
| D7 | Orden de comidas y mapeo de estado (`NOT_LOGGED`→"Sin registrar", `COMPLETED`→"Completada", `SKIPPED`→"Omitida", estado desconocido→sin chip) viven en utilidades puras testeables. | Lógica determinista en capa unit. |
| D8 | Accesos rápidos: tres CTAs de navegación a rutas existentes `/meal-plan`, `/recipes`, `/shopping-list`. No se duplica el generador de plan ni el perfil. | Ticket: no duplicar. |
| D9 | Saludo: "Hola, {primer nombre}" tomando el primer token del nombre de la sesión; si el nombre es null/vacío/solo espacios → "Hola". Sin franja horaria ("Good morning"). | Copy neutral, determinista. |
| D10 | Base de datos / Prisma / migraciones: ninguna. | Cambio puramente frontend con fixtures. |

ADR: no requerido (no cambia contrato de API, datos, seguridad ni costo). El contrato A (`AdherenceResponse`, `MealCompletionStatus`) solo se consume como tipo.

## 2. Modelo de vista

```ts
type MealCompletionStatus = 'NOT_LOGGED' | 'COMPLETED' | 'SKIPPED'; // contrato A
type MealType = 'BREAKFAST' | 'LUNCH' | 'SNACK' | 'DINNER';

type CardState<T> =
  | { kind: 'loading' }
  | { kind: 'error'; retry: () => void } // retry obligatorio; el texto de error es fijo
  | { kind: 'unavailable' }
  | { kind: 'ready'; data: T };

type TodayMeal = {
  plannedMealId: string;
  mealType: MealType;
  title: string;
  recipeId: string | null;
  status: MealCompletionStatus | null; // null o valor no reconocido = estado desconocido
  image?: RecipeImage | null; // opcional: el contrato A no la incluye
};

type TodayMealsData =
  | { kind: 'noPlan' }
  | { kind: 'noMealsToday' }
  | { kind: 'meals'; meals: TodayMeal[] };

type DashboardViewModel = {
  userName: string | null;
  todayMeals: CardState<TodayMealsData>;
  adherence: AdherenceWidgetProps; // contrato único con NUT-94/NUT-96 (§16); el slot no muestra valores
};
```

Utilidades puras: `buildGreeting(name)`, `sortMealsByType(meals)`, `selectTodayMeals(adherence)`, `isKnownStatus(status)`, `hasUnknownStatus(meals)`, `nextMealToLog(meals)`, `hasNextMealColumn(state)`, `getMealStatusLabel(status)`, `buildUnavailableViewModel(name)`. Las etiquetas de tipo de comida (Desayuno, Almuerzo, Merienda, Cena) se reutilizan del módulo de plan de comidas.

Claves de fixture dev (`?estado=`): `loading`, `sin-plan`, `sin-comidas`, `comidas` (mixto), `todo-registrado`, `error`, `error-parcial`, `no-disponible`, `sin-nombre`. Una clave desconocida, vacía o ausente muestra el estado "No disponible todavía", igual que producción. Los fixtures usan títulos genéricos ("Receta de ejemplo 1…") y nunca porcentajes.

## 3. Estructura de los frames (lectura de Stitch)

### Frame desktop (≈1280 px)
1. SideNavBar: marca "Terra Kitchen" + "Nourish your body"; ítems Dashboard (activo), Meal Plan, Recipes, Shopping List, Goals; botón "Create Plan"; tarjeta usuario con avatar foto, "Elena Russo", "Premium Member".
2. TopNavBar: buscador "Search recipes, ingredients..."; botones notificaciones y settings; avatar.
3. Bienvenida: H2 "Good morning, Elena" + "You've completed 85% of your weekly nutrition goals. Keep it up!".
4. Bento grid 12 columnas, gap 24:
   - Fila 1: "Next Meal" (lg:col-7; imagen 50% + contenido 50% en md+): imagen, badge "Next Meal: Lunch", título "Mediterranean Quinoa Bowl", descripción, "15 mins", "420 kcal", CTA "Start Cooking →". | "Weekly Adherence" (lg:col-5; fondo surface-container-low): gráfico de barras Lun–Dom, menú "more_horiz", "Calories 1,850/2k", "Protein 112g/140g".
   - Fila 2: "Healthy Habit of the Day" (md:col-4; tertiary-container, lightbulb, consejo de caminata/glucosa, link "Learn more about digestion"). | Accesos rápidos (md:col-8, grid 2): "Edit Today's Plan", "Generate New Plan".
   - Fila 3: "Recent Achievements" (col-12) con "View All": "7 Day Streak", "Veggie Master", "Calorie Crusher".

### Frame mobile (≈390 px)
1. TopNavBar fija h-16: marca "Terra", botón notificaciones, avatar foto.
2. Saludo: H1 "Hola, Martina" + "Hoy es un buen día para nutrirte."
3. Tarjeta "Progreso Semanal" (surface-container): "85%", barra de progreso, 7 círculos L M M J V S D con checks.
4. "Próxima comida" con chip "Almuerzo": imagen h-56 con gradiente, "Hamburguesa de Quinoa", "25 min", "420 kcal".
5. Accesos rápidos (1 columna): "Editar mi Plan" (primary-fixed), "Generar nuevo Plan" (secondary-fixed), con chevron.
6. "Inspiración para hoy" (grid 2): "Hidratación — Bebe 2 vasos de agua ahora", "Nutrición — Agrega semillas a tu hamburguesa".
7. BottomNavBar: Dashboard, Meal Plan, Recipes, Shopping, Goals. FAB "+" contextual.

Observación clave: **ningún frame contiene la lista "Comidas de hoy"**; ambos muestran una sola tarjeta "Próxima comida". La lista es un elemento fuera del mockup (sección 11).

## 4. Estructura por breakpoint (implementación)

Breakpoints Tailwind existentes: mobile `<768px`, `md ≥768px`, `lg ≥1024px`. Contenedor principal dentro del área de contenido del AppLayout. Sin scroll horizontal en ningún ancho (gutter 16–24 px).

### Mobile (<md) — sigue el orden del frame mobile
| Orden | Sección | Reutiliza |
|---|---|---|
| 0 | Header sticky | PageHeader existente (marca como texto, sin acciones a la derecha; §13.2) |
| 1 | Saludo H1 "Hola, {nombre}" (`text-2xl`, `text-3xl` desde md) + subtítulo "Hoy es un buen día para nutrirte." | Literata (font-headline) / Nunito Sans, on-surface / on-surface-variant |
| 2 | Slot "Progreso semanal" (tarjeta surface-container, rounded-xl) | Patrones skeleton (animate-pulse) / error / empty existentes |
| 3 | "Siguiente comida por registrar": título fuera de la tarjeta con chip verde del tipo de comida a la derecha; tarjeta blanca con sombra suave; imagen solo si existe (§15) | RecipeImage (solo con imagen), sombra existente del repo |
| 4 | "Comidas de hoy": lista vertical (miniatura solo si existe, tipo, título en hasta 2 líneas y chip de estado debajo del título) | RecipeImage modo compacto, tokens surface-container-low / outline-variant |
| 5 | Accesos rápidos: 3 botones-link apilados (ícono en cuadrado de color de 48 px + título + descripción + chevron) | material-symbols, primary-fixed / secondary-fixed / surface-container-high |
| — | Navegación inferior | BottomNavigation existente; padding inferior para no tapar contenido |

### md (768–1023px)
Sidebar + TopBar existentes. Grid 12 columnas:
- Saludo col-12.
- Fila 1: "Siguiente comida" col-12 (imagen 50% / contenido 50% cuando hay imagen); "Progreso semanal" col-12 debajo.
- Fila 2: "Comidas de hoy" col-12, lista en grid de 2 columnas.
- Fila 3: Accesos rápidos col-12, grid de 3 columnas.

### lg (≥1024px) — sigue el bento del frame desktop
- Saludo col-12.
- Fila 1: "Siguiente comida" lg:col-7 | "Progreso semanal" lg:col-5 (misma proporción del frame). Sin columna de siguiente comida, el progreso ocupa las 12 columnas.
- Fila 2: "Comidas de hoy" col-12 en el lugar visual de la fila "Healthy Habit + accesos" del frame; lista en 2 columnas para que los títulos se lean.
- Fila 3: Accesos rápidos col-12, grid de 3 (en el lugar de "Recent Achievements", que se excluye).

Resize: al cruzar md el shell cambia (resuelto por AppLayout); las tarjetas solo reacomodan columnas, sin cambiar estado ni re-pedir datos.

## 5. Copy

| Elemento | Texto |
|---|---|
| Saludo | "Hola, {primerNombre}" / "Hola" |
| Subtítulo | "Hoy es un buen día para nutrirte." |
| Slot progreso | Título "Progreso semanal" |
| Siguiente comida | Título "Siguiente comida por registrar"; chip con tipo ("Almuerzo"); CTA "Ver receta" (solo si `recipeId`) |
| Lista | Título "Comidas de hoy"; tipos "Desayuno", "Almuerzo", "Merienda", "Cena" |
| Chips | "Sin registrar" (neutral surface-container-high), "Completada" (primary-fixed + ícono check), "Omitida" (outline-variant + ícono remove); el chip incluye texto, nunca solo color |
| Accesos | "Ver mi plan semanal" → `/meal-plan` ("Revisá las comidas de la semana"); "Explorar recetas" → `/recipes` ("Buscá ideas y preparaciones"); "Lista de compras" → `/shopping-list` ("Ingredientes de tu plan") |

## 6. Tabla de estados

| Estado | Tarjeta comidas (lista + siguiente) | Slot progreso |
|---|---|---|
| loading | Skeleton de lista + skeleton de destacado; `aria-busy="true"` con texto "Cargando…" para lectores de pantalla | Skeleton de tarjeta |
| sin plan (`noPlan`) | "Todavía no tenés un plan para esta semana." + CTA "Ir a mi plan" → `/meal-plan`; sin destacado | Placeholder neutro "Tu progreso aparecerá aquí." |
| sin comidas hoy (`noMealsToday` o lista vacía) | "No hay comidas planificadas para hoy." + CTA "Ver plan semanal"; sin destacado | Placeholder neutro |
| comidas (mixto) | Lista ordenada con chips; destacado = primera "Sin registrar" | Placeholder neutro |
| todo registrado | Lista con chips (Completada/Omitida); en lugar del destacado, "Ya registraste todas las comidas de hoy." (sin afirmar consumo: "registraste", no "comiste") | Placeholder neutro |
| error | "No pudimos cargar tus comidas de hoy." + botón "Reintentar" (siempre) | "No pudimos cargar tu progreso." + "Reintentar" (siempre) |
| error parcial (estado desconocido) | Lista visible ordenada **sin chips** + nota "El estado de registro no está disponible por ahora."; sin destacado | Error del slot con "Reintentar" |
| no disponible (producción) | "No disponible todavía" + "Pronto vas a ver aquí tus comidas del día." | "No disponible todavía" |
| sin nombre | Saludo "Hola" (combinable con cualquier estado) | — |

Reglas: ningún estado queda en loading indefinido en producción (se resuelve sincrónicamente a "No disponible todavía"); los mensajes de error usan `role="alert"` solo en el contenido de error; textos sin juicio ni lenguaje clínico. La precedencia completa del slot está en §16.

## 7. Flujos

1. **Entrada producción**: usuario autenticado → `/dashboard` → AppLayout → la página lee el nombre de sesión → el proveedor de producción devuelve "no disponible" para ambas tarjetas → saludo + dos tarjetas "No disponible todavía" + accesos rápidos activos.
2. **Entrada desarrollo**: `/dashboard?estado=<clave>` → el proveedor dev carga el fixture → la página renderiza el estado correspondiente. Clave desconocida, vacía o ausente → "No disponible todavía".
3. **Navegación**: clic en un acceso rápido → ruta existente; navegación por teclado (Tab/Enter) con foco visible brand-green.
4. **Siguiente comida**: con comidas de estado conocido, se calcula la primera "Sin registrar" en orden fijo; "Ver receta" navega al detalle de receta existente solo si hay `recipeId`.
5. **Reintento**: en error, "Reintentar" siempre está presente y dispara `retry` (tarjeta de comidas) u `onRetry` (slot); la tarjeta vuelve a cargar y luego a su estado final; la otra tarjeta no cambia. En desarrollo, el reintento de los fixtures navega a `?estado=loading` y, 800 ms después, a `?estado=comidas`.

## 8. Historias y criterios de aceptación

**H1 — Saludo**: Como usuaria quiero ver un saludo con mi nombre para sentir que el inicio es mío.
- CA1: Dado nombre "María José Rosales", veo "Hola, María"; dado nombre null, vacío o solo espacios, veo "Hola" sin coma ni placeholder.

**H2 — Comidas de hoy ordenadas con estado**: Como usuaria quiero ver las comidas de hoy en orden con su estado de registro.
- CA2: Dado un fixture con comidas desordenadas, la lista se muestra Desayuno, Almuerzo, Merienda, Cena, y cada fila muestra el chip "Sin registrar", "Completada" u "Omitida" según su estado; si alguna comida tiene estado desconocido, la lista se muestra sin chips y con la nota explicativa.

**H3 — Siguiente comida por registrar**: Como usuaria quiero saber cuál es la próxima comida pendiente de registrar.
- CA3: El destacado muestra la primera comida "Sin registrar" en el orden fijo, independientemente de la hora; si todas tienen estado conocido y ninguna está sin registrar, muestra "Ya registraste todas las comidas de hoy."; nunca dice que una comida fue consumida; no aparece en sin plan, sin comidas, error, error parcial ni no disponible.

**H4 — Accesos rápidos**: Como usuaria quiero ir rápido a mi plan, recetas y lista de compras.
- CA4: Hay exactamente tres accesos con nombre accesible que navegan a `/meal-plan`, `/recipes` y `/shopping-list`; no hay acceso a generar plan ni a perfil; funcionan en mobile, md y lg.

**H5 — Estados explícitos sin datos falsos**: Como usuaria quiero que la pantalla sea honesta cuando no hay datos.
- CA5: Cada estado de la tabla 6 tiene UI y copy explícitos; todo error ofrece "Reintentar"; en producción ambas tarjetas muestran "No disponible todavía" (sin loading infinito, sin datos de ejemplo, sin números ni porcentajes en el slot de progreso); el bundle de producción no contiene los fixtures; no aparecen logros, membresía premium, rachas, notificaciones nuevas, hidratación ni consejos.

## 9. Tests requeridos

**Unit (utilidades puras)**
- `buildGreeting`: nombre compuesto, un solo nombre, null, "", "   ", espacios iniciales.
- `sortMealsByType`: orden fijo con entrada desordenada; no muta la entrada; tipos repetidos estables.
- `getMealStatusLabel`: los tres estados → "Sin registrar" / "Completada" / "Omitida"; `null` o valor no reconocido → sin etiqueta.
- `hasUnknownStatus`: true con `null` o con un valor no reconocido (p. ej. `PARTIAL`) junto a estados conocidos.
- `nextMealToLog`: primer NOT_LOGGED en orden fijo aunque esté desordenado; todos completados/omitidos → null; algún estado desconocido → null; no depende de `Date` (reloj falso a distintas horas da el mismo resultado).
- Selección de fixture: clave conocida; clave desconocida, vacía o ausente → sin fixture; el `onRetry` recibido llega a los estados de error.

**Componentes / vistas (Testing Library, consultas por rol/texto)**
- Una prueba por estado de la tabla 6 para cada tarjeta, verificando copy, presencia/ausencia de destacado y chips.
- Slot progreso: una prueba por cada combinación de la tabla de §16; en ningún caso aparece texto con `%` ni dígitos.
- Error parcial: lista visible sin chips + slot en error, simultáneamente; con `[PARTIAL, COMPLETED]` no aparece "Ya registraste…" y sí la nota.
- "Reintentar" aparece siempre en error y llama `retry` / `onRetry`.
- Imagen: la siguiente comida y las miniaturas de la lista muestran imagen solo si la comida la trae, sin placeholder.
- Accesos: tres links con `href` correctos; ausencia de "Generar" y "Perfil".
- Exclusiones: ausencia de textos "Premium", "racha", "logro", "hidratación", "consejo" en el contenido de la página.

**Página dev/prod**
- Con modo dev simulado y `?estado=<clave>` renderiza el fixture correspondiente; el reintento en `?estado=error` pasa por cargando y termina en comidas; desmontar antes del temporizador no deja timers ni avisos.
- Con modo producción simulado y sin `?estado`: ambas tarjetas "No disponible todavía", sin skeleton, sin títulos de fixture.
- Verificación de build: el bundle de producción no contiene la cadena centinela de los fixtures ni el código del reintento de desarrollo (evidencia en la PR).

**Ruta**
- `/dashboard` autenticado renderiza el Inicio (heading de saludo) dentro del AppLayout; no autenticado redirige a login (los tests de ruta existentes se mantienen).

**Responsive / E2E (evidencia QA, Playwright opcional)**
- Capturas en 390 px, 768 px y 1280 px de los estados `comidas`, `error-parcial` y producción; sin scroll horizontal.

## 10. Conflictos (elementos de los frames excluidos o sin componente) — validar con PO

| # | Frame | Elemento | Resolución |
|---|---|---|---|
| C1 | Desktop | Saludo por franja horaria "Good morning, Elena" | Excluido (depende del reloj, inglés). Se usa "Hola, {nombre}". |
| C2 | Desktop | Subtítulo "You've completed 85% of your weekly nutrition goals. Keep it up!" | Excluido (85% y métrica de NUT-94). Se usa el subtítulo del frame mobile. |
| C3 | Mobile | "85%", barra de progreso y círculos L–D con checks en "Progreso Semanal" | Excluido; solo slot con estados (NUT-94). |
| C4 | Desktop | "Weekly Adherence" con gráfico de barras Lun–Dom y menú "more_horiz" | Excluido; en su lugar, el slot sin datos. Menú sin función, se omite. |
| C5 | Desktop | "Calories 1,850/2k" y "Protein 112g/140g" | Excluido (métrica nutricional/clínica, no hay dato). |
| C6 | Ambos | Datos de ejemplo: "Elena Russo", "Martina", "Mediterranean Quinoa Bowl", "Hamburguesa de Quinoa", fotos de stock y de perfil | Excluido como dato real; nombre de sesión y fixtures genéricos solo en dev. |
| C7 | Ambos | Tiempo "15 mins"/"25 min" y "420 kcal" en próxima comida | Sin dato en `TodayMeal`; se omite. |
| C8 | Desktop | Descripción de la receta en próxima comida | Sin dato en `TodayMeal`; se omite. |
| C9 | Ambos | Imagen grande de la próxima comida | El contrato A no trae imagen; la tarjeta la muestra solo si `TodayMeal.image` existe, sin placeholder (§15). |
| C10 | Desktop | CTA "Start Cooking" | No existe modo cocina. En su lugar, "Ver receta" al detalle existente (solo con `recipeId`). |
| C11 | Desktop | "Healthy Habit of the Day" (consejo caminata/glucosa) + "Learn more about digestion" | Excluido (consejos clínicos). |
| C12 | Mobile | "Inspiración para hoy": Hidratación y Nutrición | Excluido (hidratación, consejos). |
| C13 | Desktop | "Recent Achievements": "7 Day Streak", "Veggie Master", "Calorie Crusher", "View All" | Excluido (logros, rachas). |
| C14 | Ambos | Accesos "Edit Today's Plan"/"Editar mi Plan" y "Generate New Plan"/"Generar nuevo Plan" | "Generar" excluido (no duplicar generador). "Editar" no existe como flujo propio: es "Ver mi plan semanal" → `/meal-plan`. Se suman "Explorar recetas" y "Lista de compras". |
| C15 | Desktop | Botón "Create Plan" en la sidebar | No existe en el Sidebar; no se agrega (duplica generador). |
| C16 | Desktop | "Premium Member" bajo el usuario en la sidebar | Excluido. El TopBar del shell muestra "Miembro Premium" hardcodeado en pantallas no-recetas; queda fuera del alcance de NUT-95 y se escala a PO/TL. |
| C17 | Ambos | Campana de notificaciones (TopBar desktop y header mobile) | Excluida en lo nuevo. El TopBar del shell la tiene (sin función) y no se modifica; el PageHeader mobile no la incluye. |
| C18 | Desktop | Botón settings en TopBar | Existente en el shell; no se toca. |
| C19 | Ambos | Avatar con foto | No hay foto de usuario; el shell usa iniciales. En mobile el PageHeader no incluye avatar. |
| C20 | Desktop | Buscador "Search recipes, ingredients..." | Existe en TopBar ("Buscar recetas o ingredientes..."); se reutiliza sin cambios. |
| C21 | Ambos | Marca "Terra Kitchen" / "Terra" + "Nourish your body" | Se mantiene la marca del shell (BrandMark / PageHeader "NutrIA"). |
| C22 | Ambos | Etiquetas de navegación en inglés ("Dashboard", "Meal Plan", "Shopping", "Goals") e íconos del frame | Se mantiene la navegación existente; no se renombra en este ticket. |
| C23 | Mobile | FAB "+" contextual | Excluido (acción ambigua, no hay componente). |
| C24 | Mobile | Animación de la barra de progreso / header con sombra al scroll | Excluido (no hay barra); se reutiliza el header sticky existente. |
| C25 | — | La ruta raíz `/` redirige a `/goals`, no al Inicio | Fuera del ticket; decisión de PO si el Inicio debe ser destino por defecto. |

## 11. Fuera del mockup (agregados que los frames no muestran) — validar con PO

| # | Elemento agregado | Motivo |
|---|---|---|
| F1 | Sección "Comidas de hoy" (lista de comidas con tipo, título y chip; miniatura solo si hay imagen) en mobile, md y lg | Requisito central del ticket; no existe en ningún frame. |
| F2 | Chips de estado "Sin registrar" / "Completada" / "Omitida" por comida | Contrato `MealCompletionStatus`; glosario de NUT-93 (§16). |
| F3 | Título "Siguiente comida por registrar" (en lugar de "Próxima comida"/"Next Meal") y regla de primer pendiente en orden fijo | Evitar inferencias por hora y afirmaciones de consumo. |
| F4 | Mensaje "Ya registraste todas las comidas de hoy." | Estado todo registrado. |
| F5 | Estados loading (skeleton), sin plan, sin comidas hoy, error con "Reintentar", error parcial (lista sin chips + nota + slot en error) | Estados obligatorios. |
| F6 | Estado "No disponible todavía" en ambas tarjetas (producción) | NUT-96 pendiente; no mostrar datos falsos. |
| F7 | Placeholder neutro del slot "Tu progreso aparecerá aquí." y aviso "No pudimos actualizar tu progreso." | Slot sin datos hasta NUT-94. |
| F8 | Acceso "Lista de compras" → `/shopping-list` y "Explorar recetas" → `/recipes` | Requisito del ticket. |
| F9 | CTA "Ver receta" en el destacado (en lugar de "Start Cooking") | Navegación a detalle existente. |
| F10 | Layout md intermedio (todo a col-12, lista en 2 columnas, accesos en 3) | Los frames solo definen ~390 px y ~1280 px. |
| F11 | Selector dev `?estado=<clave>` | Solo desarrollo; invisible para el usuario final. |

## 12. Base de datos / Prisma / migraciones

Ninguna. Sin cambios de schema, SQL, Neon ni endpoints. Los datos reales y su contrato llegan en NUT-96; la adherencia en NUT-94. Rollback: revertir el cambio de frontend restaura el placeholder de `/dashboard`.

## 13. Decisiones aprobadas y pendientes del PO

### 13.1 Aprobadas por la responsable (2026-10-19)
- Lista "Comidas de hoy": tarjeta destacada "Siguiente comida por registrar" + lista debajo. Pendiente de validación PO; si la rechaza, se quita.
- C10/F9: "Ver receta" hacia el detalle de receta existente, solo si la comida tiene `recipeId`.
- C14/F8: tres accesos — "Ver mi plan semanal", "Explorar recetas", "Lista de compras".
- C16/C17: el shell (TopBar) no se modifica. "Miembro Premium" y la campana se escalan a PO/TL fuera de este ticket.
- C1 (saludo "Hola, {nombre}") y C25 (raíz `/` fuera de alcance): aprobados.

### 13.2 Header móvil compartido
- Los frames móviles de todas las pantallas comparten el mismo header (marca + acciones), así que el Inicio usa el PageHeader compartido existente.
- La marca del header es texto no-heading, de modo que el saludo es el **único `h1`** del Inicio. Ninguna otra pantalla ni test usa ese header.
- El header del Inicio no incluye campana de notificaciones, avatar ni nada premium; el slot de acciones queda vacío (C17/C19).
- En el componente, lo único específico de este ticket es la etiqueta de la marca; su comentario y su contrato (`title`, `right`) se mantienen. Este ticket no quita ni agrega nada relacionado a notificaciones.
- Test requerido: el header no expone ningún rol `heading` y muestra la marca como texto.

### 13.3 Pendientes de aprobación humana
- PO valida Conflictos (sección 10) y Fuera del mockup (sección 11), en especial C14 (accesos), C10/F9 ("Ver receta"), C16 ("Miembro Premium" en el shell), C25 (ruta raíz) y el flujo de reintento en desarrollo (§16).
- Los frames de Stitch no se modificaron; si el PO quiere el mockup con la lista y los estados, es un paso separado con aprobación.

## 14. Notas para el PR (2026-10-19)

- **Orden DOM vs. orden visual (lg):** el DOM sigue el orden móvil del frame (saludo → progreso semanal → siguiente comida → comidas de hoy → accesos). En `lg` la grilla de 12 columnas ubica la siguiente comida a la izquierda (7) y el progreso a la derecha (5), como el frame desktop. Consecuencia aceptada: el único foco afectado es el botón "Reintentar" del progreso en estado de error; en ese caso el orden de tabulación en desktop no coincide con el visual. Sin columna de siguiente comida, el progreso ocupa las 12 columnas.
- **`?estado` desconocido o ausente:** en dev, solo una clave válida muestra su fixture; cualquier otra (desconocida, vacía o ausente) muestra el estado "No disponible todavía", igual que producción.
- **"Todo registrado":** el mensaje "Ya registraste todas las comidas de hoy." se muestra en el lugar de la siguiente comida, en todos los breakpoints (criterio 2).

## 15. Ajustes tras la comparación visual con Stitch (2026-10-21, para el PR, el PO y NUT-96)

- **Imagen de la siguiente comida (se aparta del frame):** el contrato A (`AdherenceResponse` / `AdherenceMeal`) **no trae imagen de receta**. La tarjeta "Siguiente comida por registrar" y las miniaturas de "Comidas de hoy" muestran la imagen **solo si existe** (render condicional, sin placeholder); hoy no se muestra y el contenido ocupa todo el ancho. El frame muestra una foto con el nombre superpuesto: esa parte queda pendiente hasta que haya imágenes. Motivo: un placeholder gris ocuparía media pantalla en móvil y parecería un error de carga.
- **Para NUT-96:** `TodayMeal` tiene un campo opcional `image`, vacío mientras el contrato A no lo traiga. Para mostrar la imagen basta con completarlo al armar las comidas de hoy (desde la receta vía `recipeId` o extendiendo el contrato); las tarjetas la muestran sin cambios de layout.
- **Comidas de hoy:** el chip de estado va debajo del título; el título usa todo el ancho y se muestra en hasta 2 líneas (`line-clamp-2`, `break-words`); en `lg` la lista usa 2 columnas.
- **Siguiente comida:** tarjeta blanca con sombra suave; el título "Siguiente comida por registrar" fuera de la tarjeta con el chip del tipo de comida a la derecha, en verde (como el frame).
- **Accesos rápidos:** ícono dentro de un cuadrado de color de 48 px. **Saludo:** `text-2xl` en móvil y `text-3xl` desde `md`.

## 16. Contrato del widget de adherencia, errores, estados desconocidos y vocabulario (review de la PR #67, 2026-10-22)

**Contrato único del widget de adherencia (opción A).** El slot de progreso recibe `AdherenceWidgetProps` (`{ data, loading, error, onRetry }`), definido en `adherence-widget/types.ts`. `DashboardViewModel.adherence` es de ese tipo. Así NUT-96 hace una sola traducción y NUT-94 reemplaza el contenido del slot sin cambiar el contrato. Precedencia en el slot (ningún caso muestra números):

| Props | Se muestra |
|---|---|
| `loading` sin `data` | skeleton (gana sobre `error`) |
| `error` sin `data` | "No pudimos cargar tu progreso." + Reintentar |
| `data` sin `loading` ni `error` | "Tu progreso aparecerá aquí." |
| `data` + `loading` | refresco: se mantienen los datos, sin skeleton ni aviso |
| `data` + `error` (sin `loading`) | datos + aviso no bloqueante "No pudimos actualizar tu progreso." con Reintentar |
| `data` + `loading` + `error` | gana `loading` (hay un reintento en curso): datos, sin aviso de error |
| `data: null`, `loading: false`, `error: null` | **"No disponible todavía"**. **No es un estado de carga**: es el estado de producción hasta NUT-96 (sin skeleton) |

**401.** El 401 lo resuelve el manejador global de sesión; el widget nunca lo recibe y NUT-96 no debe pasarlo como `error`.

**Documentación del contrato.** `adherence-widget/types.ts` (dueño: PR #67 / NUT-95) documenta cada prop (`data`, `loading`, `error`, `onRetry`), esta tabla y la regla del 401.

**Error siempre recuperable.** El error de `CardState` es `{ kind: 'error'; retry: () => void }`: `retry` es obligatorio (el compilador exige una salida) y no hay `message` (el texto es fijo y no se exponen mensajes del backend). "Reintentar" aparece siempre en error. En desarrollo, el reintento de los fixtures navega a `?estado=loading` y luego a `?estado=comidas` para que el PO valide el camino completo de recuperación.

**Estados desconocidos.** Todo estado que no sea `NOT_LOGGED`, `COMPLETED` o `SKIPPED` (incluido `null` o uno nuevo del backend) cuenta como desconocido y cae en "error parcial": no se afirma "Ya registraste todas las comidas de hoy." y se muestra la nota de estado no disponible.

**Vocabulario de estados.** Glosario aprobado de NUT-93: `NOT_LOGGED` → "Sin registrar", `COMPLETED` → "Completada", `SKIPPED` → "Omitida". Al 2026-10-22 ese mapa no existe en `main`, así que vive en `MEAL_STATUS_LABELS` de este módulo. **Pendiente:** unificarlo en un módulo compartido que importen NUT-93, NUT-94 y NUT-95 (coordinar con Fer).

**Merge.** Orden: mergear primero esta PR (#67) y después rebasear #68 sobre `main`. Al rebasear, se sacan del diff de #68 `dashboard/types.ts` y `adherence-widget/types.ts` (quedan las versiones de `main`, que vienen de #67), y #68 queda solo con sus fixtures y tests.
