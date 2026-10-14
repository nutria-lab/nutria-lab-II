# NUT-80 — Regenerar semana con confirmación explícita

## Objetivo

Permitir que una persona solicite una nueva propuesta semanal de forma intencional, entendiendo que la propuesta actual dejará de ser la vista vigente, sin disparar regeneraciones accidentales ni solicitudes duplicadas.

## Alcance

- Añadir una CTA explícita “Regenerar semana” en la vista del plan semanal.
- Mostrar un diálogo de confirmación adaptado a mobile como bottom sheet y una variante equivalente para tablet/desktop.
- Ejecutar la regeneración únicamente después de confirmar.
- Mantener visible el plan actual durante toda la operación.
- Mostrar estados recuperables de progreso, éxito y error.
- Actualizar la vista vigente con la respuesta completa cuando la regeneración termina correctamente.
- Conservar el día de la semana seleccionado durante el reemplazo de la propuesta.

## Fuera de alcance

- Historial de versiones.
- Restaurar una versión anterior.
- Cambios en shopping list.
- Cambios en el contrato backend existente.
- Cambios de esquema o migración de base de datos.
- Rediseño general del Planificador Semanal.

## Decisiones de producto y arquitectura

1. La intención del usuario se expresa en tres fases: `idle`, `confirming` y `submitting`.
2. La confirmación es obligatoria; cerrar o cancelar en `confirming` solo vuelve a `idle` y no hace requests.
3. Al confirmar se crea una única intención de regeneración con un UUID de idempotencia estable para todo ese intento.
4. Un doble click, Enter repetido o una interacción táctil duplicada no crea una segunda request.
5. Mientras `submitting`, el plan anterior permanece renderizado y el diálogo queda bloqueado para evitar una nueva intención.
6. Cerrar el diálogo durante `submitting` solo oculta la superficie visual; no aborta ni reinicia la operación ni genera otra request.
7. En éxito se reemplaza el plan local por la respuesta completa del endpoint. El día seleccionado se conserva si existe en la nueva respuesta; si no, se selecciona el primer día disponible.
8. En error se conserva el plan anterior y se muestra una acción “Reintentar”. El retry usa la misma intención/idempotency key mientras esa intención siga activa; no se crea una intención paralela.
9. El backend existente sigue siendo la autoridad para autorización, validación, concurrencia y transición de versiones.
10. No se requiere persistencia nueva: el estado del diálogo, la request activa y la respuesta vigente son estado de UI/cliente.

## Flujo principal

1. La persona visualiza el plan semanal.
2. Activa “Regenerar semana”.
3. Se abre el diálogo.
4. El diálogo explica: “Se creará una propuesta nueva y reemplazará la actual como vista vigente”.
5. “Cancelar”, Escape, cierre o click fuera del diálogo antes de confirmar vuelven al plan sin llamar al backend.
6. “Confirmar regeneración” crea la intención, fija el UUID y ejecuta el POST existente con `reason: USER_REQUESTED`.
7. La UI muestra progreso global, mantiene el plan anterior y bloquea confirmaciones adicionales.
8. En éxito se muestra la nueva semana y un estado de confirmación no bloqueante.
9. En error se mantiene la semana anterior, se informa el fallo y se ofrece retry.

## Estados UX obligatorios

### Confirmación

- Mobile: bottom sheet alineado con el frame de referencia NUT-80.
- Tablet/desktop: diálogo centrado con la misma jerarquía y contenido.
- Focus inicial en el título o acción primaria según el patrón existente.
- Focus trap mientras el diálogo está abierto.
- Escape y botón de cierre equivalen a cancelar solo antes de enviar.
- Botones con nombres accesibles: “Cancelar” y “Regenerar semana”.

### Progreso

- El plan actual sigue visible.
- El diálogo o banner global indica que se está generando una nueva propuesta.
- La acción primaria queda deshabilitada y comunica estado ocupado.
- No debe aparecer el estado vacío ni un skeleton que borre la semana vigente.

### Éxito

- Se cierra la superficie de confirmación/progreso.
- Se muestra el plan nuevo completo.
- Se conserva el día seleccionado cuando es válido.
- Se comunica que la semana fue regenerada.

### Error

- El plan anterior sigue visible.
- Se muestra un mensaje accionable sin detalles técnicos sensibles.
- “Reintentar” reutiliza la intención activa y su idempotency key.
- Cancelar/cerrar el estado de error no genera otra llamada.

## Contrato de integración

```http
POST /meal-plans/:planId/regenerate
Idempotency-Key: <uuid-estable-por-intento>
Content-Type: application/json

{"reason":"USER_REQUESTED"}
```

La capa cliente debe aceptar la respuesta completa del plan, normalizar fechas como el flujo actual y entregar el resultado al estado de la pantalla. La key no debe generarse dentro de cada retry.

## Historia de usuario

Como persona que está viendo mi plan semanal,
quiero confirmar explícitamente que deseo regenerar toda la semana,
para obtener una nueva propuesta sin perder accidentalmente la actual ni enviar solicitudes duplicadas.

## Criterios de aceptación

- [ ] La vista muestra una CTA inequívoca “Regenerar semana”.
- [ ] Activar la CTA abre el diálogo y no llama a la API.
- [ ] El diálogo explica el reemplazo de la propuesta vigente.
- [ ] Cancelar, cerrar, Escape o click fuera antes de confirmar no llaman a la API.
- [ ] Confirmar realiza exactamente una request con la ruta, body y header definidos.
- [ ] Doble click, Enter repetido y doble interacción táctil no duplican la request.
- [ ] El progreso mantiene visible el plan actual y bloquea nuevos submits.
- [ ] Back o close durante la operación no inicia una request adicional ni reinicia la intención.
- [ ] En éxito se muestra la respuesta completa y se conserva el día seleccionado válido.
- [ ] En error el plan anterior sigue visible y aparece una acción de retry.
- [ ] Retry usa la misma intención y `Idempotency-Key`.
- [ ] El diálogo es usable con teclado y lector de pantalla.
- [ ] La experiencia está resuelta para mobile, tablet y desktop.
- [ ] Existe evidencia visual de confirmación, progreso, error y éxito en mobile y desktop.

## Dependencias y riesgos

- NUT-68 aporta la estructura visual del Planificador Semanal.
- NUT-78 aporta el endpoint real y la semántica de idempotencia del backend.
- La respuesta lenta de OpenAI exige que el estado de progreso no dependa de un timeout corto del cliente.
- Una key creada por request impediría el retry seguro; debe vivir en el controlador de intención, no en la función HTTP aislada.
- El cierre del diálogo no debe cancelar lógicamente la operación iniciada; de lo contrario una respuesta tardía podría dejar la UI inconsistente.

## Estrategia de persistencia

No hay cambios de Prisma, SQL ni migraciones. La versión nueva y la transición de `GenerationRun` ya son responsabilidad del endpoint existente. El cliente solo conserva temporalmente la intención, su key y el plan anterior hasta recibir un resultado.

## Evidencia de cierre

- Captura mobile del diálogo de confirmación.
- Captura desktop del diálogo de confirmación.
- Captura mobile y desktop del progreso con el plan anterior visible.
- Captura mobile y desktop del estado de error con retry.
- Captura mobile y desktop del éxito mostrando la nueva versión y el día previamente seleccionado.
- Registro de una sola request al confirmar y ausencia de request al cancelar.

## Nota de validación

Este plan prioriza la implementación UX solicitada. La validación se realizará mediante revisión manual del flujo y evidencia visual; los tests automatizados quedan fuera de la prioridad indicada para esta iteración.
