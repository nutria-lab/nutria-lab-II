# NUT-102 — Entrega del componente con fixtures

Estado local: implementado y verificado. Fecha de contexto: 25/10/2026. No se acredita integración de API ni cierre en Linear.

## Alcance entregado

- Módulo público `apps/web/src/modules/adherence/index.ts`: exporta `MealAdherenceControl`, sus props y tipos exactos del contrato A.
- Props documentadas: `meal`, `pending: boolean`, `error: string | null`, `onSetStatus(status)`.
- Estados `NOT_LOGGED`, `COMPLETED`, `SKIPPED`; deshacer explícito mediante «Sin registrar»; sin selección optimista ni mutación del DTO.
- Bloqueo por `pending` o `canEdit=false` mediante `aria-disabled` y guard del manejador, manteniendo el foco. El contenedor debe activar `pending` al recibir una intención.
- Explicación visible/asociada de la regla de edición, región estable de estado, alerta de error y recuperación por nueva elección.
- Fixtures tipados: semana de referencia con los tres estados/comida futura no editable/receta nullable; semana pasada editable; sin plan; plan sin comidas. Contadores y porcentajes coherentes, incluidos `null` cuando no hay comidas.
- Terra con responsive según ancho propio del control y acciones de al menos 44 px.
- Entrada independiente de desarrollo `apps/web/adherence-preview.html`: muestra datos ficticios y permite resolver manualmente una intención como éxito o error.

No se modificaron archivos existentes de `apps/web`, router, dashboard, landing, servicios HTTP o backend. Git final en ese alcance informa únicamente el módulo nuevo y el HTML nuevo. Los cambios previos del harness se preservaron.

## Validación de producto

El usuario/PO validó explícitamente la propuesta: «Valido la propuesta Terra; continuar sin Stitch». La propuesta comprende los tres botones, estado seleccionado, guardado bloqueante, recuperación de error y explicación de la regla con `canEdit=false`. Stitch devolvió `Authentication required`; la excepción para continuar con Terra del repo fue autorizada antes de implementar.

## Pruebas ejecutadas

Desde `apps/web`:

```powershell
node node_modules/vitest/vitest.mjs run src/modules/adherence/components/tests/MealAdherenceControl.test.ts src/modules/meal-plan/components/tests/MealCard.test.tsx
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
```

Resultados finales: **27/27 tests, 2 suites, exit 0**; **TypeScript exit 0**; **Vite build exit 0**.

TDD: el tester creó primero el archivo `.test.ts` y obtuvo rojo por import ausente del módulo/fixture. Después de implementar, corrigió únicamente dos defectos del test: `exact` no pertenece a las opciones ByRole de RTL y `toBeLessThan` no compara strings. La suite nueva pasó **21/21**, sin omitir pruebas. Las otras seis pruebas verifican la regresión de `MealCard`.

Cobertura: estados/selección accesible, completar/omitir/deshacer, no callback sobre selección actual, DTO inmutable, bloqueo de clic y teclado, foco, transición pendiente/error/reintento/éxito, error como texto seguro, formulario ancestro, IDs únicos y coherencia de fixtures.

## Evidencia en navegador

Playwright 1.64.1 instalado únicamente en `.nutria/runtime/qa/node_modules`, sin cambios a dependencias/lockfiles de la aplicación. Navegador: Edge headless 156.0.4314.42. Vite en `http://127.0.0.1:5173/adherence-preview.html`.

Scripts reproducibles desde la raíz, con Vite levantado:

```powershell
node .plans/nut-102-adherence-controls/capture-responsive.cjs
node .plans/nut-102-adherence-controls/verify-keyboard.cjs
```

| Tamaño | Captura | Resultado |
| --- | --- | --- |
| Móvil 390 × 844 | [mobile.png](evidence/mobile.png) | Sin overflow; 21 controles dentro del viewport y con altura mínima 44 px |
| Tablet 768 × 1024 | [tablet.png](evidence/tablet.png) | Sin overflow; mismos controles/estados, adaptación verificada |
| Desktop 1440 × 1000 | [desktop.png](evidence/desktop.png) | Sin overflow; acciones en tres columnas según espacio disponible |
| Estrecho 320 × 844 | [narrow.png](evidence/narrow.png) | Sin overflow; acciones apiladas y textos largos contenidos |

Las cuatro ejecuciones registran cero errores de página. Las capturas contienen los tres estados, pendiente, error y no editable; fueron inspeccionadas visualmente por el coordinador. Datos medidos en [responsive-checks.json](evidence/responsive-checks.json).

Teclado real en navegador: Tab, Enter y Espacio; bloqueo durante pendiente; selección confirmada conservada; error, reintento, éxito y deshacer; comida no editable bloqueada. Foco conservado al resolver la simulación sin moverlo artificialmente a otro control; `:focus-visible` activo con outline sólido de 3 px. Evidencia: [pendiente](evidence/keyboard-pending.png), [error](evidence/keyboard-error.png), [éxito](evidence/keyboard-success.png), [resultados](evidence/keyboard-checks.json) y [árbol accesible](evidence/control-accessibility.yml).

Comprobación adicional de reflow con CSS `body zoom: 2`: sin overflow a 1440 px; [captura](evidence/zoom-200-percent.png). No equivale a una sesión manual de zoom del navegador o de lector de pantalla. Los anuncios se verificaron mediante semántica/árbol accesible y pruebas; no se ejecutó una sesión manual de NVDA/VoiceOver.

El primer intento de captura coincidió con una recarga HMR al editar el preview y falló por destrucción del contexto. Se repitió tras estabilizar los archivos y pasó; se clasificó como condición del entorno, no defecto del producto.

## Revisión

Cuatro revisores frontend, con lentes de riesgo, fiabilidad, resiliencia y legibilidad: **sin hallazgos accionables**. No quedan bloqueantes/critical de revisión local. No implica aprobación de merge/release, que corresponde a TL/QA.

## Handoff y pendientes externos

NUT-93 consume el export público y conecta cookie, GET/PUT, invalidación y errores 401/409; NUT-93/NUT-99 acreditan API real y flujo integrado. Este ticket entrega únicamente el componente con fixtures.

Planificación original: Fer Cesio (FE1), 2 h / 2 puntos; 2 h extraídas de NUT-93 (6 → 4 h), sin ampliar capacidad. No hay acceso a Linear/tracker ni una fuente de horas reales en esta sesión; no se registraron horas, comentarios o cambios de estado ni se inventó una desviación de esfuerzo. Registro externo pendiente.

CodeGraph CLI funciona pero no hay índice; se usaron búsquedas locales tras el fallo de `explore`. Faltan los archivos de bibliotecas `bundles/` referidos por los roles; se usaron roles y skills instalados. Google Modern Web Guidance CLI devolvió -1 sin salida en los intentos de consulta; no se atribuye un guide ID recuperado. Se consultaron estas fuentes primarias para botones nativos, foco y regiones de estado:

- [Google web.dev: Keyboard focus](https://web.dev/learn/accessibility/focus)
- [Google web.dev: JavaScript y accesibilidad](https://web.dev/learn/accessibility/javascript)
- [W3C APG: Button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/)
