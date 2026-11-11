# NUT-102 — Plan de implementación

Generado: 2026-10-22T20:23:33-03:00 (America/Buenos_Aires).
Diseño fuente: `.plans/nut-102-adherence-controls/design.md`. Propuesta Terra aprobada por usuario/PO; autorizado continuar sin Stitch. Este plan no añade integración API.

## Evidencia de exploración y límites

- Leídos `AGENTS.md`, `.ai/index.md`, `.ai/architecture.md`, `.ai/quality-and-testing.md`, `.ai/frontend-and-stitch.md`, `.ai/adherence.md`, `.ai/codegraph.md` y `management/links.md`.
- `bundles/agent-libraries.json` y `bundles/development/AGENTS.md` no existen en este checkout. Se usa el rol instalado `.codex/agents/frontend-explorer.toml` y skills `codegraph-guidance` / `google-modern-web-guidance`. No cargar bibliotecas ajenas al rol.
- El coordinador probó CodeGraph CLI: funciona el ejecutable pero `explore` no encuentra índice y prohíbe inicializar desde IA. Fallback explícito a búsquedas `rg`; no hay evidencia indexada. La restricción de escritura del explorer también excluye generar índices.
- Google Modern Web Guidance falla con exit -1 sin salida según reintentos del coordinador. Documentación primaria recuperada por el coordinador: https://web.dev/learn/accessibility/focus, https://web.dev/learn/accessibility/javascript y https://www.w3.org/WAI/ARIA/apg/patterns/button/. No atribuir un guide ID recuperado.
- Stitch requiere autenticación; excepción aprobada. Engram y Linear MCP no están disponibles. No afirmar memoria persistida ni ticket actualizado.
- `apps/web/src/modules/meal-plan/components/MealCard.tsx`: `MealCard` se ocupa de recetas/reemplazos y enlaces; su `MealCardProps` no corresponde al contrato A. No modificarlo ni incrustar controles nuevos en él.
- `apps/web/src/services/mealPlanService.ts`: tipos del plan, no contrato de adherencia. Búsqueda en `apps/web/src` no encuentra `AdherenceResponse`, `MealCompletionStatus` ni `MealAdherenceControl`. Crear módulo separado; no ampliar ese servicio.
- `apps/web/src/index.css:3` define Terra mediante `@theme`: verde `brand-green-dark`, fondos crema/surface, ámbar `tertiary`/`tertiary-fixed`, texto `on-surface`, errores `error`/`on-error-container`, tipografías `font-headline` y `font-body` (líneas 5–57). Reutilizar tokens; no cambiar el tema global.
- `apps/web/vite.config.ts`: plugins React/Tailwind; alias `@` a `src`; Vitest jsdom y setup `./src/test/setup.ts`. `apps/web/src/test/setup.ts` instala jest-dom, cleanup tras cada test y matchMedia fallback.
- `apps/web/src/main.tsx` monta el router; queda fuera del alcance. `apps/web/index.html` aporta viewport/es y carga fuentes Terra; usarlo como referencia para preview independiente, sin editarlo.
- `apps/web/tsconfig.json`: strict, JSX react-jsx, incluye `src`; los archivos nuevos del módulo serán typechecked. `apps/web/package.json`: Vite, TypeScript, Vitest 4.1.11, RTL y user-event ya instalados.
- Baseline informado por coordinador: seis pruebas de `MealCard.test.tsx` pasan (exit 0). Las nuevas pruebas no deben copiar sus casts `as never`.

## Archivos nuevos y responsabilidades

1. `apps/web/src/modules/adherence/types.ts`
   - Exportar `MealCompletionStatus`, `AdherenceResponse` completo y alias `AdherenceMeal = AdherenceResponse['days'][number]['meals'][number]`.
   - Copiar literalmente el contrato A del ticket: timezone literal, plan nullable, contadores/resúmenes, porcentaje nullable, recipeId nullable y cuatro mealType. No añadir DTO PUT, HTTP ni causas de canEdit.
2. `apps/web/src/modules/adherence/fixtures/adherence.fixture.ts`
   - Exportaciones acordadas para tests y preview: `adherenceFixture: AdherenceResponse`, `noPlanAdherenceFixture: AdherenceResponse`, `emptyPlanAdherenceFixture: AdherenceResponse`, `pastWeekAdherenceFixture: AdherenceResponse`.
   - Respuesta principal weekStart 2026-10-19, timezone Buenos Aires, today determinista. Contener comidas identificables con tres estados y recipeId=null; futura no editable y pasada editable. Porcentajes/counts coherentes; sin cálculos de producción.
   - `noPlanAdherenceFixture`: plan:null, days:[], contadores cero, porcentaje null. `emptyPlanAdherenceFixture`: plan presente sin comidas y porcentaje null. `pastWeekAdherenceFixture`: semana anterior de plan vigente con comida editable. Definir datos con anotación/satisfies; sin `any`/casts para ocultar errores.
3. `apps/web/src/modules/adherence/components/MealAdherenceControl.tsx`
   - Exportar `MealAdherenceControl` y `MealAdherenceControlProps` con JSDoc de cada prop y expectativas del contenedor. Props exactas: meal, pending:boolean, error:string|null, onSetStatus:(MealCompletionStatus)=>void.
   - Componente controlado; ni estado optimista ni fetch ni Date para autorización. No mutar meal.
   - Tres botones type=button, labels del diseño, aria-pressed; grupo nombrado incluyendo título. Conservar foco/DOM. `aria-disabled` y guard en callback para pending o !canEdit; elegir estado actual no llama.
   - Región de estado estable con anuncio de guardado/estado confirmado; error role=alert, texto escapado. Evitar que aria-busy silencie el anuncio de guardado si se usa en un ancestro.
   - Explicación exacta de bloqueo del diseño visible y asociada por aria-describedby; IDs por instancia con useId. No agregar motivo al DTO.
   - Terra mediante utilidades existentes. Acciones mínimo 44 px. Apilado cuando ancho propio <28rem y tres columnas al disponer de espacio suficiente, evitando el caso de dos columnas + botón huérfano. Puede usar CSS local si no se expresa claramente con clases.
4. Opcional solo si necesario: `apps/web/src/modules/adherence/components/MealAdherenceControl.css`, importado por el componente, con reglas acotadas para responsive intrínseco/foco/wrapping. No modificar CSS global.
5. `apps/web/src/modules/adherence/index.ts`
   - Barrel público: componente, props y tipos de contrato. JSDoc breve sobre handoff a NUT-93. Fixtures se importan de su ruta dedicada; no mezclarlos en exports de producto.
6. `apps/web/src/modules/adherence/components/tests/MealAdherenceControl.test.ts`
   - Único archivo de pruebas nuevo; tester escribe solo `*.test.ts`/`*.spec.ts`. Usar React.createElement en lugar de JSX. Importar módulo público y fixture tipado.
7. `apps/web/adherence-preview.html` y `apps/web/src/modules/adherence/fixtures/adherence-preview.tsx`
   - Preview de desarrollo independiente de Vite: HTML es/viewport/root/entrada module y fuentes como referencia del index existente. Entry importa `../../../index.css`, componente y fixtures; monta un showcase controlado local, sin router, auth o HTTP.
   - Accesible en `/adherence-preview.html` con servidor Vite. No modificar configuración de build ni incluir otra página de producto. Indicar claramente que es muestra con datos ficticios.
   - Mostrar estados normal (tres), pendiente, error y no editable. Una muestra interactiva mínima simula pendiente y éxito/error por estado local para verificar foco/recuperación; no implementar red ni persistencia. Separar controles del showcase de los tres botones del componente con labels claros.
   - Muestra de título/error largos para QA y diseño intrínseco. No representar porcentajes en el componente. Si se incluye resumen de contexto, denominar «Progreso de la semana».

## Etapa tester: rojo antes de implementación

Escribir el test antes de crear archivos productivos; import pendiente puede producir el rojo por módulo inexistente. Informar comando, exit y error real. Casos con fixtures tipados:

- Parametrizados los tres estados, exactamente un aria-pressed=true y nombres/grupo accesibles.
- COMPLETED, SKIPPED y NOT_LOGGED emiten enum exacto una vez por intención; seleccionada no emite; meal conserva sus datos.
- Pending=true bloquea clic, Enter y Espacio; dos activaciones no duplican callback. Mantiene selección confirmada, anuncia Guardando y foco.
- canEdit=false bloquea activaciones y asocia explicación visible; no inferir fecha ni prohibir semana pasada editable.
- rerender pending→success actualiza selección y anuncio; pending→error permite repetir intención cuando pending=false; error no cambia selección ni inyecta HTML.
- type=button evita submit de formulario ancestro; múltiples instancias no colisionan en IDs; tabulación/foco permanecen al cambiar props.
- Fixtures contrato completo: nulabilidad, cero/sin plan coherentes; no añadir lógica de porcentajes a producción.

## Implementación y comandos de verificación

Implementer lee este plan y el diseño, crea mínimo para pasar las pruebas. No tocar backend, Prisma, migraciones, servicios HTTP, router, dashboard, landing ni otras pantallas.

Ejecutar desde `apps/web` usando Node directo (wrappers npm/npx problemáticos en entorno):

```powershell
node node_modules/vitest/vitest.mjs run src/modules/adherence/components/tests/MealAdherenceControl.test.ts
node node_modules/vitest/vitest.mjs run src/modules/meal-plan/components/tests/MealCard.test.tsx
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173
```

Vite build no incorpora preview al bundle principal por defecto; el entry queda chequeado por TypeScript al vivir en src. No cambiar scripts/dependencias para estas verificaciones. Reportar fallos previos separadamente.

## Evidencia y revisión

Capturar preview real a 390, 768 y 1440 px con estados normal/pendiente/error/bloqueado; revisar además 320 px, 200 % zoom, contenido largo, foco visible por teclado, mínimo 44 px y no overflow. La disponibilidad de Playwright no quedó confirmada en esta exploración (sin herramienta MCP de browser/Playwright descubierta ni instalación local encontrada superficialmente); el coordinador puede usar browser disponible o tooling ya cacheado, sin afirmar ejecución que no ocurrió.

Después de verde, cuatro revisores según AGENTS; sintetizar bloqueantes antes de declarar listo. Registrar evidencia como componente con fixtures, no funcionalidad integrada. Cierre de horas/Linear corresponde al agente final; no inventar horas si no hay datos ni MCP. Preservar cambios del harness presentes en el árbol compartido.
