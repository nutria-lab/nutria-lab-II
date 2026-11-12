# NUT-100 — Verificación de inicio, dashboard y flujos cruzados

Corrida de evidencia: 2026-11-12 (jueves), ~01:45 America/Argentina/Buenos_Aires.
Base: `main` en `d74a27d` + el fix de accesos rápidos de esta rama.
Alcance: QA de frontend sobre la landing, el acceso, la autenticación y el inicio. Solo se corrigen bugs de frontend de esa superficie. No se tocan endpoints, modelos Prisma ni migraciones.

## Entorno

- **Base de datos:** la de desarrollo local (`localhost:5433`, contenedor `nutria-postgres`) con las migraciones al día.
  - `pnpm seed` recrea los planes de la semana actual (`weekStart` 2026-11-09) para los 3 usuarios de prueba, con LUNCH y DINNER por día.
- **Servidores:** API (`apps/api`, `pnpm dev`, :3000) y web (`apps/web`, `pnpm dev`, :5173). El access gate está activo.
- **Usuarios:**
  - A = `usuario.prueba1@nutria.com` (con plan).
  - B = `usuario.prueba2@nutria.com` (con plan).
  - C = `qa.nut100.sinplan@nutria.test` (registrado sin nombre, `name: null`, y sin plan).
  - A y B tienen el mismo primer nombre ("Usuario"): en las capturas los distingue el progreso (A con 7,1 %, B con 0 %).
- **Datos del día:** hoy (BA) es 2026-11-12. Las comidas de hoy son Pasta al Pesto (LUNCH) y Pizza Integral (DINNER); mañana hay Wrap de Atun.
- **Navegador:** Chromium con Playwright, zona `America/Argentina/Buenos_Aires`. Breakpoints: D = desktop 1440×900, T = tablet 768×1024, M = móvil 375×812.
- **Capturas:**
  - D y T son de página completa.
  - M son por pantalla (viewport de 375 con scroll, sufijo `-pantallaN`). Cada pantalla se superpone con la siguiente para que la barra inferior fija no tape contenido.
  - Se entregan aparte del repo, en la carpeta `nut-100-capturas`. Los frames de Stitch están en su subcarpeta `stitch`.
- **Fallas simuladas:** 500, 401, `planId` distinto y 409 se simulan interceptando las respuestas de la API en el navegador. La regeneración real no se ejecuta porque llama al proveedor de IA. Todo lo demás usa la API y la base reales.
- **StrictMode:** en desarrollo, React StrictMode monta dos veces, así que cada lectura del inicio aparece duplicada (la primera se aborta). En producción no pasa.

## Matriz criterio × breakpoint

Estados: OK, FALLA, OK (parcial) y NO VERIFICADO. En M, `-pantalla1..N` indica las capturas consecutivas de la misma vista.

### Landing y acceso

| # | Criterio | D | T | M |
|---|---|---|---|---|
| 01 | `/` sin sesión, backend disponible. Sin requests a la API ni campos de usuario. | OK — `01-landing-D.png` | OK — `01-landing-T.png` | OK — `01-landing-M-pantalla1..4.png` |
| 02 | `/` sin sesión, backend caído | OK — `02-landing-sin-backend-D.png` | OK — `02-landing-sin-backend-T.png` | OK — `02-landing-sin-backend-M-pantalla1..4.png` |
| 03 | CTAs a `/register` y `/login` | OK — `03-cta-D-1-register.png`, `03-cta-D-2-login.png` | OK — `03-cta-T-1-register.png`, `03-cta-T-2-login.png` | OK — `03-cta-M-1-register-pantalla1..2.png`, `03-cta-M-2-login.png` |
| 04 | Rutas privadas sin sesión → `/login` | OK — `04-bloqueo-D.png` | OK — `04-bloqueo-T.png` | OK — `04-bloqueo-M.png` |
| 05 | Deep link privado conservado: gate → login → vuelve a `/shopping-list` | OK — `05-deeplink-D-1-gate.png`, `05-deeplink-D-2-login.png`, `05-deeplink-D-3-destino.png` | OK — `05-deeplink-T-1-gate.png`, `05-deeplink-T-2-login.png`, `05-deeplink-T-3-destino.png` | OK — `05-deeplink-M-1-gate.png`, `05-deeplink-M-2-login.png`, `05-deeplink-M-3-destino-pantalla1..2.png` |
| 06 | Login → `/dashboard` | **FALLA** — `06-login-dashboard-D-1-form.png`, `06-login-dashboard-D-2-destino.png` | **FALLA** — `06-login-dashboard-T-1-form.png`, `06-login-dashboard-T-2-destino.png` | **FALLA** — `06-login-dashboard-M-1-form.png`, `06-login-dashboard-M-2-destino-pantalla1..4.png` |
| 07 | Logout → landing pública | **FALLA** — `07-logout-D-1-antes.png`, `07-logout-D-2-despues.png` | **FALLA** — `07-logout-T-1-antes.png`, `07-logout-T-2-despues.png` | **FALLA** (sin control) — `07-logout-M-sin-control-pantalla1..3.png` |

En 04 se probaron `/dashboard`, `/meal-plan`, `/shopping-list`, `/recipes` y `/goals`; todas redirigen a `/login`. La captura muestra el caso de `/dashboard`.

### Inicio

| # | Criterio | D | T | M |
|---|---|---|---|---|
| 08 | Con plan: comidas de hoy (LUNCH → DINNER), siguiente comida y "Progreso de la semana" (0 % = 0 de 14) | OK — `08-inicio-con-plan-D.png` | OK — `08-inicio-con-plan-T.png` | OK — `08-inicio-con-plan-M-pantalla1..3.png` |
| 09 | Sin plan (404 en `/meal-plans/current`) y nombre `null`: "Hola", estado vacío y sin porcentaje | OK — `09-inicio-sin-plan-D.png` | OK — `09-inicio-sin-plan-T.png` | OK — `09-inicio-sin-plan-M-pantalla1..2.png` |
| 10 | Registrar en el plan y volver al inicio: COMPLETED (7,1 %) → SKIPPED ("Ya registraste todas las comidas de hoy.") → NOT_LOGGED (vuelve a 0 %) | OK — `10-registro-D-1-plan-completada.png`, `10-registro-D-2-inicio-completada.png`, `10-registro-D-3-inicio-omitida.png`, `10-registro-D-4-inicio-deshecho.png` | OK — `10-registro-T-1-plan-completada.png`, `10-registro-T-2-inicio-completada.png`, `10-registro-T-3-inicio-omitida.png`, `10-registro-T-4-inicio-deshecho.png` | OK — `10-registro-M-1-plan-completada-pantalla1..2.png`, `10-registro-M-2-inicio-completada-pantalla1..2.png`, `10-registro-M-3-inicio-omitida-pantalla1..2.png`, `10-registro-M-4-inicio-deshecho-pantalla1..3.png` |
| 11 | Comidas futuras no editables | OK — `11-futuras-D.png` | OK — `11-futuras-T.png` | OK — `11-futuras-M-pantalla1..2.png` |
| 12 | Cambio de usuario A → B sin datos de A | OK — `12-cambio-usuario-D-1-A-antes.png`, `12-cambio-usuario-D-2-logout.png`, `12-cambio-usuario-D-3-B-despues.png` | OK — `12-cambio-usuario-T-1-A-antes.png`, `12-cambio-usuario-T-2-logout.png`, `12-cambio-usuario-T-3-B-despues.png` | **OK (parcial)** — `12-cambio-usuario-M-1-A-antes-pantalla1..2.png`, `12-cambio-usuario-M-2-logout.png`, `12-cambio-usuario-M-3-B-despues-pantalla1..3.png` |
| 13 | Error parcial: compras 500. El resto sigue y compras muestra "Reintentar". | OK — `13-error-compras-D.png` | OK — `13-error-compras-T.png` | OK — `13-error-compras-M-pantalla1..3.png` |
| 14 | Error parcial: adherencia 500. Comidas de hoy desde el plan y progreso con "Reintentar". | OK — `14-error-adherencia-D.png` | OK — `14-error-adherencia-T.png` | OK — `14-error-adherencia-M-pantalla1..2.png` |
| 15 | 401 → manejo global de sesión (`/login`) | OK — `15-sesion-401-D.png` | OK — `15-sesion-401-T.png` | OK — `15-sesion-401-M.png` |
| 16 | `planId` distinto entre respuestas: una sola reconsulta y estado recuperable, sin mezclar versiones | OK — `16-conflicto-planid-D.png` | OK — `16-conflicto-planid-T.png` | OK — `16-conflicto-planid-M-pantalla1..2.png` |
| 17 | 409 `ADHERENCE_STALE`: recarga sin reaplicar (1 PUT, queda "Sin registrar", aviso "El plan cambió…") | OK — `17-stale-adherencia-D.png` | OK — `17-stale-adherencia-T.png` | OK — `17-stale-adherencia-M.png` |
| 18 | 409 `SHOPPING_LIST_STALE`: recarga sin reaplicar (1 PATCH, queda sin marcar, aviso) | OK — `18-stale-compras-D.png` | OK — `18-stale-compras-T.png` | OK — `18-stale-compras-M-pantalla1..2.png` |
| 19 | Accesos rápidos legibles | OK (sin cambios a 1440) | **FALLA antes → OK con el fix** — `19-accesos-rapidos-T-768-antes.png`, `19-accesos-rapidos-T-768-despues.png`, `19-accesos-rapidos-T-1024-antes.png`, `19-accesos-rapidos-T-1024-despues.png` | OK (apilados) |

### No verificado en navegador

| Criterio | D | T | M | Motivo / cobertura |
|---|---|---|---|---|
| Porcentaje `null` con 0 comidas (nunca 0, 100 ni NaN) | NO VERIFICADO | NO VERIFICADO | NO VERIFICADO | El seed no permite un plan con 0 comidas. Cubierto por `AdherenceWidget.test.tsx` ("plan without meals (null percent)"). Sin plan no se muestra porcentaje (09). |
| Orden completo BREAKFAST, LUNCH, SNACK, DINNER | NO VERIFICADO | NO VERIFICADO | NO VERIFICADO | El seed solo trae LUNCH y DINNER, que se ven en orden (08). Cubierto por `utils.test.ts` ("is the fixed order…"). |
| Regeneración real del plan en otra pestaña | NO VERIFICADO | NO VERIFICADO | NO VERIFICADO | Llama al proveedor de IA. El efecto (`planId` distinto) se simuló en 16. |
| Comparación con el frame de Stitch | Comparado | **NO VERIFICADO** | Comparado | Stitch no tiene frame de tablet. Solo existen "Dashboard - Terra Kitchen" (desktop) y "Dashboard - Móvil". |

### 12 — Cambio de usuario: resultado del chequeo automático del DOM

Después de llegar a `/login`, un `MutationObserver` revisa cada cambio del DOM hasta que el inicio de B termina de cargar. Busca rastros de A: "1 de 14 comidas completadas", "Completadas 1" o "7,1 %".

| | D | T | M |
|---|---|---|---|
| A antes | 7,1 % (1 de 14) | 7,1 % (1 de 14) | 7,1 % (1 de 14) |
| Vía de cierre de sesión | botón "Cerrar sesión" | botón "Cerrar sesión" | `POST /auth/logout` desde la página y después navegación dentro de la app, que recibe 401 y dispara el manejo global de sesión |
| Recarga de página | no | no | no |
| Frames con datos de A después del login de B | 0 | 0 | 0 |
| Lecturas nuevas para B (plan, adherencia, compras) | 6 | 6 | 6 |
| B después | 0 % (0 de 14) | 0 % (0 de 14) | 0 % (0 de 14) |

**M es una verificación parcial.** No hay control de cierre de sesión en la UI móvil (ver 07). La sesión se cerró por otra vía, sin recargar la página, así que el estado en memoria de la app sí se puso a prueba. El recorrido que haría una persona desde la UI móvil no se pudo verificar.

## Fallas

### 06 — El login sin ruta previa no lleva al dashboard

- **Pasos:**
  1. Sin sesión, con el gate desbloqueado, abrir `/login` directamente (no desde un deep link).
  2. Ingresar con A.
- **Esperado:** `/dashboard`. **Obtenido:** `/goals`.
- **Breakpoints:** D, T y M.
- **Causa probable:** `LoginRoute` (`apps/web/src/app/App.tsx`, líneas 24-28) usa `'/goals'` como destino cuando no hay `state.from`.
- **Decisión:** escalado, no corregido. Es exactamente el alcance de NUT-97 ("Entrar al dashboard tras autenticarse conservando la landing pública").

### 07 — El logout no vuelve a la landing pública

- **Pasos:**
  1. Con sesión en D o T, hacer clic en "Cerrar sesión" (sidebar).
- **Esperado:** `/`. **Obtenido:** `/login`. La sesión sí se cierra: `/auth/me` responde 401.
- **Breakpoints:** D y T. En M no hay control (ver abajo).
- **Causa probable:** `AuthProvider.logout` (`apps/web/src/features/auth/AuthProvider.tsx`, líneas 150-151) reutiliza `invalidate`, que siempre navega a `/login` (líneas 80-81). La misma función maneja el vencimiento de sesión (401), así que hay que separar el logout explícito del vencimiento.
- **Decisión:** escalado, no corregido (NUT-97).

### 07-M — En móvil no se puede cerrar sesión

- **Pasos:**
  1. Con sesión, en un viewport menor a 768 px, abrir cualquier ruta privada.
- **Obtenido:** no hay ningún control de cierre de sesión. El sidebar está oculto (`md:flex`) y la barra inferior solo navega.
- **Breakpoints:** M.
- **Decisión:** pendiente de PO. Es UI nueva que no está en el frame "Dashboard - Móvil". No se agregó ningún control. Impide verificar el cambio de usuario desde la UI móvil (12 queda parcial).

## Fix aplicado: accesos rápidos (criterio 19)

### Síntoma y medición

Ancho de texto por tarjeta, con las fuentes cargadas:

| Viewport | Antes (`md:grid-cols-3`) | Con el fix (`xl:grid-cols-3`) |
|---|---|---|
| 768 | 20 px: las palabras se cortan letra por letra | 348 px (apiladas) |
| 1024 | 100 px: el texto ocupa 3-4 líneas, apretado pero legible | 588 px (apiladas) |
| 1280 | 185 px | 185 px (3 columnas, sin cambios) |
| 1440 | 239 px | 239 px (3 columnas, sin cambios) |

- **Causa:** desde `md` (768) el sidebar ocupa 240 px. Tres columnas en el ancho restante dejan muy poco espacio para el texto hasta ~1180 px.
- **Cambio:** `QuickAccessLinks` usa `xl:grid-cols-3` en lugar de `md:grid-cols-3`, y el título de la tarjeta agrega `break-words`. Debajo de 1280 px las tarjetas se apilan.
- **Tests:** primero un test rojo y después verde, en `QuickAccessLinks.test.tsx`. El test falla con cualquier grilla de varias columnas antes de `xl`.
- **Commit propio:** el fix va aislado (componente y test) para poder commitearlo y revertirlo por separado.

### Contradice NUT-95 §5

El diseño de NUT-95 (§5) especifica accesos rápidos en **grid de 3 columnas en md (768–1023) y en lg (≥1024)**. El fix los apila entre 768 y 1279 px, así que **se aparta de ese diseño aprobado**.

- **Por qué el diseño no alcanza:** no tuvo en cuenta que el sidebar de 240 px ya aparece desde `md`.
- **Justificación corregida:** que el frame móvil apile los accesos no alcanza para justificar el cambio, porque ese frame es de otro breakpoint. Lo que lo justifica es la legibilidad medida a 768.
- **Lo que decide el PO:**
  - (a) Mantener el fix: apiladas hasta 1279 px.
  - (b) Corregir solo 768–1023 (`lg:grid-cols-3`), aceptando el texto apretado de 1024–1279.
  - (c) Revertir y definir otra grilla en diseño.

## Requiere decisión del PO

1. **Accesos rápidos vs NUT-95 §5:** opciones (a), (b) o (c) de arriba. Evidencia en las capturas `19-accesos-rapidos-T-*`.
2. **Logout en móvil:** no existe control; agregarlo es UI nueva fuera del frame.
3. **Estados y elementos que no están en Stitch** (pendientes desde tickets anteriores):
   - **NUT-94 §9:**
     - Porcentaje grande debajo del título (S2).
     - Contadores, frase "X de N", nota de comidas futuras y estados (S8).
     - Textos nuevos de §8.
     - Exclusión de círculos por día, gráfico por día y datos nutricionales (S3, S5, S6).
     - El mismo texto "Todavía no tenés un plan…" en dos tarjetas.
   - **NUT-95 §13.3:**
     - Conflictos de §10 y elementos fuera del mockup de §11, en particular la lista "Comidas de hoy", los tres accesos (C14), "Ver receta" (C10/F9), "Miembro Premium" en el shell (C16) y la ruta raíz (C25).
     - Estados vacío, error y conflicto del inicio (visibles en 09, 13, 14 y 16).

## Escalado (no aplicado)

| Tema | A quién | Detalle |
|---|---|---|
| Login → `/dashboard` y logout → `/` (06, 07) | NUT-97 | No están en `main`. NUT-97 aparece como prerrequisito en la descripción de NUT-100, pero **no figura en blocked-by**. |
| Logout en móvil | PO / diseño (+ NUT-97) | Ver arriba. |
| `weekStart` del seed | Backend (seed) | El seed calcula el lunes en UTC, no en America/Argentina/Buenos_Aires. Entre las 21:00 y las 24:00 (BA) del domingo crea el plan de la semana siguiente. Afecta solo al entorno de prueba. |
| Títulos del seed | Backend (seed) | Los títulos de las comidas no coinciden con la receta vinculada (todos los almuerzos usan "Pollo con Arroz"). El inicio y el plan muestran nombres distintos para la misma comida. |
| Migraciones locales | Equipo | La base local no tenía las migraciones de NUT-88 y NUT-91. Conviene correr `prisma migrate deploy` después de actualizar `main`. |

### Observaciones fuera de la superficie (sin acción)

- Con `name: null`, la barra superior muestra el email del propio usuario. No es una fuga: es su propio dato.
- La búsqueda de recetas persiste en `sessionStorage` entre cambios de usuario dentro de la misma pestaña. Es el catálogo, no datos personales.

## Revisión del fix (4 revisores en paralelo, 2026-11-11)

Resultado: sin hallazgos blocker, critical ni major.

| Revisor | Hallazgo | Decisión |
|---|---|---|
| Risk | El fix solo afecta 768–1279 px. | Sin acción. |
| Risk | `.mcp.json` tiene un cambio local, ajeno al ticket, con una API key literal. | Queda fuera de todo commit. |
| Readability | El comentario del test contaba la historia del ticket. | Ajustado: ahora solo deja la razón. |
| Resilience | El título de la tarjeta no tenía `break-words`. | Agregado. |
| Reliability | El test solo descartaba `md:` y `lg:`. | Ahora falla con cualquier grilla de varias columnas antes de `xl`. |
| Reliability | Dijo que `useDashboardData.test.tsx` fallaba (`getAdherence.mockReset is not a function`). | Solo pasa al correr Vitest desde la raíz del repo, sin la config de `apps/web`: ahí no se resuelve el alias `@/` de los mocks. Con el script del paquete pasa. No es estado compartido entre tests. |

## Verificación

Corrida del 2026-11-12 con el fix aplicado:

| Chequeo | Resultado |
|---|---|
| Suite web completa, corrida 1 | 71/71 archivos, 1022/1022 tests |
| Suite web completa, corrida 2 | 71/71 archivos, 1022/1022 tests |
| Suite web completa, corrida 3 | **70/71 archivos, 1020/1022 tests**: 2 tests de `RecipeForm.test.tsx` superaron el límite de 10 s (ver abajo) |
| Suite web completa, corrida 4 (adicional) | 71/71 archivos, 1022/1022 tests |
| `useDashboardData.test.tsx` | Pasó en las 4 corridas; no hubo nada que corregir |
| `tsc --noEmit` web y api | OK |
| `pnpm lint` (monorepo) | 2/2 tareas OK |
| `pnpm build -- --force` (monorepo, sin caché) | 2/2 tareas OK |

**Fallas de la corrida 3:**
- **Tests afectados:** "deshabilita el botón de envío mientras la petición está pendiente" y "muestra el banner correspondiente para un error "validation"…", ambos en `RecipeForm.test.tsx`.
- **Corridos aislados:** pasan 3/3, con unos 2,5 s cada uno, contra un `testTimeout` de 10 s. El archivo completo tarda unos 50 s por el tipeo con `userEvent`.
- **En la suite completa:** con la carga de los workers en paralelo, en una de cuatro corridas superaron el límite. Vitest además informó un worker que no terminó a tiempo.
- **Diagnóstico:** es un test lento e intermitente del módulo de recetas, ajeno a esta superficie y a este cambio. Se reporta y no se corrige en este ticket.

## Capturas

- Carpeta `nut-100-capturas` (fuera del repo): corrida del 2026-11-12, citada en la matriz.
- Subcarpeta `stitch`: `stitch-dashboard-desktop.jpg` y `stitch-dashboard-movil.png`.
- Subcarpeta `corrida-2026-11-11`: la corrida anterior, con datos del miércoles. Se conserva como respaldo y no se cita en la matriz.
