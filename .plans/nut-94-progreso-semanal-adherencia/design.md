# NUT-94 — Progreso semanal de adherencia en el dashboard

Etapa: diseño. Actualizado: 2026-10-27. Fuente visual: Stitch proyecto `5785725448623770239`, frames "Dashboard - Móvil" (`ae8d7cb5…`, 780 px @2x) y "Dashboard - Terra Kitchen" (`e631a85a…`, 2560 px @2x), solo lectura.

## 1. Decisiones

| # | Decisión | Motivo |
|---|---|---|
| D1 | El widget recibe `AdherenceWidgetViewProps = AdherenceWidgetProps & ExpectedAdherence`. `AdherenceWidgetProps` (`data`, `loading`, `error`, `onRetry`) es el contrato de NUT-103 sin cambios; `ExpectedAdherence` (`expectedWeekStart?`, `expectedPlanId?: string \| null`) es opcional. | §16 de NUT-95 fija un único contrato con NUT-96. Los valores esperados permiten no mezclar versiones (CA4) sin tocar ese contrato. |
| D2 | `onRetry` es obligatorio en el tipo. Todo estado de error muestra "Reintentar". | Ningún error sin salida. |
| D3 | El 401 lo resuelve el manejo global de sesión. El widget no lo recibe y no tiene estado para sesión vencida. | Contrato D: "401 usa el manejo global de sesión". |
| D4 | La UI usa textos fijos; `error` es un valor interno que nunca se muestra. | Los clientes no dependen de mensajes del backend. |
| D5 | Datos "no utilizables" = obsoletos (semana o plan distintos de lo esperado) o inconsistentes (§3). Nunca se muestran: con `loading` se ve la carga; sin `loading`, error recuperable. | Evita mezclar versiones y evita una carga infinita si nadie vuelve a pedir datos. La reconsulta acotada es de NUT-96. |
| D6 | El widget no calcula métricas: muestra `summary` tal como llega y solo formatea el porcentaje (`es-AR`, hasta 1 decimal, "32,1 %"). | "Sin calcular otra métrica". |
| D7 | Sin plan con comidas cero → "Sin datos de progreso"; nunca 0 % ni 100 %. | CA1: `null` es sin datos. |
| D8 | Nota fija: el total incluye las comidas de los próximos días. | CA2. |
| D9 | No hay círculos L–D ni gráfico por día. | Un "día cumplido" sería una métrica nueva (§7, P4). |
| D10 | El widget no lee enums del contrato (`status`, `mealType`, `timezone`); solo `plan`, `weekStart` y `summary`. | Los enums de comidas se validan donde se muestran (tarjeta de comidas de NUT-95). |

ADR: no requerido.

## 2. Combinaciones de estado

Las filas cubren todas las combinaciones de `data` × `loading` × `error`.

| `data` | sin loading ni error | `loading` | `error` | `loading` + `error` |
|---|---|---|---|---|
| `null` | "No disponible todavía" (producción hasta NUT-96) | skeleton | "No pudimos cargar tu progreso." + Reintentar | skeleton |
| no utilizable (obsoleta o inconsistente) | "No pudimos cargar tu progreso." + Reintentar | skeleton | "No pudimos cargar tu progreso." + Reintentar | skeleton |
| utilizable | contenido (§4) | contenido, sin skeleton ni aviso (refresco) | contenido + aviso "No pudimos actualizar tu progreso." + Reintentar | contenido, sin aviso (reintento en curso) |

## 3. Datos utilizables

Obsoleta: `expectedWeekStart` informado y distinto de `data.weekStart`, o `expectedPlanId` informado (incluido `null`) y distinto de `data.plan?.id ?? null`. Sin valores esperados no hay comparación.

Consistente (reglas del contrato A que el widget necesita para no afirmar algo falso):
- contadores enteros ≥ 0;
- `completedMeals + skippedMeals + notLoggedMeals === plannedMeals`;
- `plan: null` implica `plannedMeals === 0`;
- `plannedMeals === 0` implica `adherencePercent === null`;
- `plannedMeals > 0` implica `adherencePercent` finito entre 0 y 100.

No se verifica que el porcentaje sea `completed / planned × 100`: eso sería recalcular la métrica.

## 4. Contenido con datos utilizables

| Caso | Se muestra |
|---|---|
| `plan: null` | "Todavía no tenés un plan para esta semana." + "Cuando tengas un plan, vas a ver acá cómo avanza tu semana." |
| plan sin comidas (`adherencePercent: null`) | "Sin datos de progreso" + "Tu plan no tiene comidas planificadas esta semana." |
| comidas sin completadas ni omitidas | resumen + "Todavía no hay comidas registradas esta semana." |
| comidas con registros | resumen |

Resumen: porcentaje, "X de N comidas completadas", barra de progreso, contadores Completadas / Omitidas / Sin registrar y la nota de comidas futuras.

## 5. Accesibilidad y responsive

- `section` con `aria-labelledby` al `h2` "Progreso de la semana".
- El resumen es una región `aria-live="polite"` `aria-atomic="true"`: al volver del registro se anuncia el nuevo resumen.
- Barra `role="progressbar"` con nombre "Progreso de la semana", `aria-valuenow`, `aria-valuemin=0`, `aria-valuemax=100` y `aria-valuetext` igual al texto visible.
- Contadores en `dl`; el estado se dice con texto, nunca solo con color.
- Único control: "Reintentar" (botón nativo, mínimo 44 px, foco visible). Sin error no hay paradas de foco.
- Una columna en todos los anchos; contadores en grilla de 3 con `min-w-0` y etiquetas con `break-words` (entra en 320 px). Ubicación en la grilla del inicio: columna completa en móvil y tablet; en `lg`, 5 columnas a la derecha cuando hay siguiente comida y 12 cuando no.
- No hay imágenes ni títulos dinámicos en el widget, así que no aplican huecos de imagen ni `line-clamp`.

## 6. Fixtures y pruebas

| Estado | Fixture | Test | Clave dev (`?estado=`) |
|---|---|---|---|
| no disponible | `createAdherenceWidgetProps('unavailable')` | combinaciones | `no-disponible` |
| carga | `'loading'` | combinaciones | `loading` |
| error sin datos | `'error'` | combinaciones, teclado | `error`, `error-parcial` |
| reintento sin datos | `'retrying'` | combinaciones | (transición tras Reintentar) |
| sin plan | `'noPlan'` | contenido | `sin-plan` |
| sin comidas | `'planWithoutMeals'` | contenido | `progreso-sin-comidas` |
| sin registros | `createAdherenceWidgetStateProps('noRecords')` | contenido | `progreso-sin-registros` |
| progreso | `'partial'` | contenido, a11y | `comidas`, `todo-registrado`, `sin-comidas`, `sin-nombre` |
| refresco | `'refreshing'` | combinaciones | `progreso-actualizando` |
| datos + error | `'staleWithError'` (NUT-103: datos + error) | combinaciones, teclado | `progreso-error-actualizacion` |
| obsoleto (semana / plan) | `'staleWeek'`, `'stalePlan'` | combinaciones, teclado | `progreso-desactualizado` |
| inconsistente | `'inconsistent'` y un caso por regla de §3 | combinaciones, reglas aisladas | `progreso-inconsistente` |

Las combinaciones con `loading` y `error` se prueban pisando esas props sobre cada fixture base.

En dev, cada error del progreso tiene camino de recuperación: Reintentar → `?estado=loading` → `?estado=comidas`, que muestra el progreso parcial.

Los fixtures de dev se cargan solo con `import.meta.env.DEV`. El build de producción no contiene `nut95-dashboard-fixture-sentinel`, `fixture-plan-partial`, `fixture-plan-regenerated`, "Comida de ejemplo", "Receta de ejemplo" ni `fixture: adherence request failed`.

## 7. Diferencias con Stitch

| # | Frame | En el frame | En la implementación | Origen |
|---|---|---|---|---|
| S1 | Móvil | Título "Progreso Semanal" | "Progreso de la semana" | Ticket (CA2) |
| S2 | Móvil | Porcentaje chico a la derecha del título | Porcentaje grande debajo del título | Pendiente PO |
| S3 | Móvil | 7 círculos L–D con checks | Sin círculos | Exclusión: métrica nueva (D9) |
| S4 | Móvil / desktop | "85%" fijo | Valor del backend | Ticket (CA5) |
| S5 | Desktop | "Weekly Adherence" con gráfico de barras Lun–Dom y menú "more_horiz" | Mismo widget que móvil, sin gráfico ni menú | Exclusión: métrica por día y menú sin función |
| S6 | Desktop | "Calories 1,850/2k" y "Protein 112g/140g" | Sin datos nutricionales | Exclusión: no afirmar consumo |
| S7 | Desktop | Subtítulo "You've completed 85% of your weekly nutrition goals. Keep it up!" | Subtítulo del frame móvil (NUT-95) | Exclusión: valor fijo y tono |
| S8 | Ambos | Solo el estado con datos | Contadores, frase "X de N", nota de futuras y todos los estados de §2 y §4 | Fuera del mockup: pendiente PO |

## 8. Vocabulario

| Texto | Origen |
|---|---|
| "Todavía no tenés un plan para esta semana." | Reutilizado de NUT-95 (tarjeta de comidas) |
| "No disponible todavía", "No pudimos cargar tu progreso.", "No pudimos actualizar tu progreso.", "Reintentar", "Cargando…" | Reutilizados de NUT-95 (§16) |
| "Completadas", "Omitidas", "Sin registrar" | Plural del glosario de NUT-93 ("Completada", "Omitida", "Sin registrar"); validar con PO |
| "Progreso de la semana" | Ticket. NUT-90 usa el mismo título para el progreso de compras; validar con PO |
| "X de N comidas completadas" | Nuevo; mismo patrón que "X de N marcados" de NUT-90; validar con PO |
| "Sin datos de progreso", "Tu plan no tiene comidas planificadas esta semana." | Nuevo; validar con PO |
| "Cuando tengas un plan, vas a ver acá cómo avanza tu semana." | Nuevo; validar con PO |
| "Todavía no hay comidas registradas esta semana." | Nuevo; validar con PO |
| "Incluye todas las comidas planificadas de la semana, también las de los próximos días." | Nuevo; validar con PO |

## 9. Pendiente de aprobación PO

- S2, S8 y los textos nuevos de §8.
- Exclusiones S3, S5 y S6.
- En `sin-plan`, ambas tarjetas muestran "Todavía no tenés un plan para esta semana.": confirmar si se mantiene el mismo texto en las dos.

## 10. Base de datos y migraciones

No aplica: componente presentacional, sin HTTP ni schema.
