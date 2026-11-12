# NUT-108 — Reemplazo de comidas en escritorio (diseño frontend)

Etapa: diseño. Generado: 2026-11-12. Alcance: solo frontend; sin cambios de backend ni de contratos. Relacionado: NUT-79 (diseño aprobado del reemplazo desde la tarjeta, flujos 4.1–4.4 y ADR-002).

## 1. Problema

En la grilla semanal de escritorio (≥1280 px, plan de 7 días) la acción "Cambiar comida" guarda la comida elegida pero no se muestra ninguna confirmación, así que no se puede reemplazar ninguna comida desde escritorio. La vista móvil funciona con su confirmación dentro de la tarjeta.

## 2. Decisiones

| # | Decisión | Motivo |
|---|---|---|
| D1 | Se reutiliza el diálogo de confirmación de reemplazo que ya existe en el módulo del plan; no se crea otro. | Un solo componente para la misma intención. |
| D2 | El diálogo sigue el patrón WAI-ARIA `dialog` modal: título con el nombre de la comida, descripción del alcance, "Cancelar" y "Reemplazar comida". Al abrir, el foco va a "Reemplazar comida" (o a "Cancelar" si confirmar está bloqueado); Tab/Shift+Tab quedan atrapados dentro; Escape, clic en el fondo y "Cancelar" cierran sin enviar nada y devuelven el foco al botón que lo abrió. | NUT-79 ADR-002; criterio de foco y teclado. |
| D3 | Confirmar cierra el diálogo y envía la petición; durante la carga sólo la tarjeta afectada queda bloqueada (superposición de carga, `aria-busy`, botón deshabilitado). El resto de la grilla, el selector de día y "Regenerar plan" siguen activos. | Criterio "se bloquea sólo la comida afectada"; NUT-79 flujo 4.1. |
| D4 | Foco durante la carga: como el botón de la tarjeta queda deshabilitado, el foco pasa a la tarjeta afectada (enfocable por programa). Al terminar, con éxito o con error, y al descartar el error con "Cancelar", vuelve al botón "Cambiar comida" de esa tarjeta, salvo que el usuario lo haya llevado a otro lugar. "Reintentar" desde la grilla repite el mismo recorrido. La tarjeta reacciona solo a esas transiciones, nunca al montarse. | No perder el foco en un control deshabilitado o desmontado; NUT-79 §ADR accesibilidad. |
| D5 | Hay un solo reemplazo en curso a la vez (lo garantiza el hook de reemplazo). Si se abre el diálogo de otra comida mientras hay uno en curso, "Reemplazar comida" queda deshabilitado con un aviso; "Cancelar" y Escape siguen activos. Cuando el reemplazo en curso termina, confirmar se habilita sin cerrar el diálogo ni mover el foco. | Nunca descartar en silencio una confirmación. |
| D6 | El bloqueo del diálogo se deriva del id de la comida en reemplazo (estado de React), no de la bandera interna del hook (que no provoca re-render). | Estado observable y consistente. |
| D7 | Idempotencia: cada confirmación genera una clave; "Reintentar" después de un error reutiliza la misma clave y la misma comida. Se usa el hook existente sin cambiar su contrato con el servicio. | Criterio de idempotency key. |
| D8 | Éxito: se reemplaza sólo esa comida en el plan en memoria; el día seleccionado (`?day=`) y el scroll se conservan porque no hay recarga ni navegación. Se anuncia por la región en vivo "X reemplazado por Y.". | Criterio de éxito. |
| D9 | Error: la tarjeta conserva la comida anterior y muestra un texto fijo con "Reintentar" y "Cancelar". Nunca se muestra el mensaje técnico del backend o del cliente HTTP. Aplica también a móvil. | Regla de mensajes fijos; toda falla tiene salida. |
| D10 | La vista móvil mantiene su confirmación dentro de la tarjeta, sin diálogo. | Fuera de alcance cambiar móvil. |
| D11 | Si el plan cambia con el diálogo abierto (termina una regeneración) y la comida ya no está en el plan vigente, el diálogo se cierra sin enviar nada. | Nunca confirmar un reemplazo sobre otra versión del plan. |

ADR: no requerido (no cambia contratos de API ni modelo de datos).

## 3. Estados de la tarjeta de escritorio

| Estado | Se muestra | Foco |
|---|---|---|
| Inactiva | Tarjeta normal, "Cambiar comida" activo | — |
| Diálogo abierto | Diálogo modal sobre la página | Dentro del diálogo |
| Cargando (esta comida) | Superposición "Reemplazando…", `aria-busy`, botón deshabilitado; diálogo cerrado | En la tarjeta |
| Cargando (otra comida) | Tarjeta normal y activa | Sin cambios |
| Éxito | Nueva comida en la misma posición | Botón "Cambiar comida" |
| Error | Comida anterior + texto fijo + "Reintentar" / "Cancelar" | Botón "Cambiar comida" |
| Error → Cancelar | Comida anterior, sin aviso | Botón "Cambiar comida" |
| Error → Reintentar | Igual que "Cargando (esta comida)", con la misma clave | En la tarjeta |

## 4. Textos

| Uso | Texto | Origen |
|---|---|---|
| Título del diálogo | "Reemplazar {comida}" | NUT-79 flujo 4.1 |
| Descripción | "Solo se cambiará este plato. Las demás comidas de tu plan se mantendrán iguales." | NUT-79 flujo 4.1 |
| Acciones | "Cancelar" / "Reemplazar comida" | NUT-79 ADR-002 |
| Error en tarjeta | "No pudimos reemplazar la comida. Podés reintentar o cancelar." | Texto ya existente en el hook; pendiente de validación PO frente a NUT-79 4.4 |
| Bloqueo por otro reemplazo | "Hay otro reemplazo en curso. Vas a poder confirmar cuando termine." | Nuevo; pendiente de validación PO |

## 5. Criterios de aceptación y pruebas

| Criterio | Prueba automatizada |
|---|---|
| Abre una confirmación accesible que identifica la comida | Diálogo con nombre "Reemplazar {comida}", `aria-modal`, descripción y foco inicial |
| Teclado | Tab/Shift+Tab atrapados en el diálogo |
| Cancelar / Escape no envían peticiones ni cambian datos | Sin llamadas al servicio; foco vuelve al botón |
| Confirmar envía una sola petición | Una llamada con plan, comida y clave; el diálogo se cierra |
| Sólo se bloquea la comida afectada | Tarjeta afectada ocupada y con foco; otra tarjeta y "Regenerar plan" activas |
| Éxito actualiza sólo esa comida y conserva el día | Título nuevo, otra comida intacta, `?day=` y pestaña sin cambios, foco en el botón |
| Error conserva la tarjeta y ofrece Reintentar/Cancelar | Texto fijo (nunca el técnico), botones, foco en el botón; Cancelar limpia el error y deja el foco en el botón |
| Reintento con la misma idempotency key | La segunda llamada repite la clave de la primera; al terminar, foco en el botón |
| Cambio de plan con el diálogo abierto | Una regeneración que termina con el diálogo abierto lo cierra sin llamadas |
| Un solo reemplazo a la vez | Confirmar bloqueado con aviso, sin robar foco, y luego habilitado |
| Móvil sigue funcionando | Confirmación en tarjeta sin diálogo; error con texto fijo |
| Hook: texto fijo de error | Error con mensaje técnico, sin mensaje y rechazo que no es `Error`; el texto es el aprobado |
| Regresión | Las pruebas de escritorio fallan sin el diálogo conectado |

Verificación manual (no automatizable en jsdom): conservación del scroll y comportamiento real en ≥1280 px y <1280 px.

## 6. Fuera de alcance

Selector manual de recetas, regeneración semanal, cambios de contratos/backend y rediseño general.
