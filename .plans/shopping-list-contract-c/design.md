# Diseño de compras con fixtures del contrato C

Fecha: 2026-10-25. Estado: propuesta; este documento no implementa producto ni constituye aprobación PO.

## Resultado, alcance y planificación

Al entrar a `/shopping-list` mediante la navegación existente, la persona ve ingredientes, cantidades disponibles, advertencias y progreso de la semana seleccionada. Reemplazar el placeholder con una vista reutilizable alimentada por fixtures tipados. NUT-90 conectará esa misma UI con GET/PATCH reales.

Responsable: Fer Cesio (FE1). Estimación: 4 h / 4 puntos previstos para 15–21/10; vencimiento 2026-10-21. La fecha de este diseño es posterior y no implica reprogramación. Horas reales desconocidas; no se registran ni infieren. Compromiso del sprint: 57/72 h, reserva 15 h; no añadir alcance ni capacidad.

## Decisiones antes de implementar

Localizar referencias Compras desktop/móvil y su versión vigente. El ticket pegado es la fuente disponible; el documento Linear no pudo consultarse. Presentar los estados nuevos de carga, sin plan, vacío, parcial, error y sesión vencida para aprobación PO. La aprobación anterior de adherencia NO aprueba compras. Confirmar selector de semana y comportamiento de checks de demostración. Stitch requiere autenticación; la planificación continúa, pero un frame base no aprueba nuevos estados.

Conservar Terra y componentes existentes, con Tailwind según la convención solicitada. Confirmar destinos existentes del planificador y sesión sin inventar nuevas rutas. Cambios de contrato/diseño pendiente se escalan antes de absorber esfuerzo.

## Arquitectura y contrato

Vista controlada con semana seleccionada, estado de transporte/sesión y ShoppingListResponse; callbacks para cambiar semana, reintentar y establecer checked sobre una key. Contenedor de fixtures en memoria separado de la vista, reemplazable por NUT-90. La UI aparece en la entrada normal de compras; no dejar una demo aislada como único acceso.

Preservar exactamente ShoppingListResponse: weekStart; plan nullable con id/version/updatedAt; items con key/name/quantity nullable/unit nullable/checked/sources; cada source con plannedMealId/recipeId/ingredientIndex/quantity nullable/unit nullable; summary con totalItems/checkedItems; warnings con code/plannedMealId/ingredientIndex opcional. Únicos warnings: MISSING_RECIPE e INVALID_INGREDIENT. Sin campos nuevos en DTO.

Mantener orden recibido y semana. No agregar, normalizar, fusionar ni convertir ingredientes o unidades en frontend: esas reglas son del productor C. g y kg permanecen separados. Mostrar hasta 3 decimales sin redondeos intermedios ni alterar datos originales; quantity null es «Cantidad no disponible» y unit null no inventa unidad. No mostrar null como cero.

weekStart es lunes real YYYY-MM-DD. Usar calendario para mostrar rango lunes–domingo; evitar conversiones por zona horaria del navegador. Al cambiar semana mostrar carga identificada con la nueva semana sin atribuirle datos previos.

## Flujos y estados

1. Entrada/cambio de semana: encabezado y semana visibles, carga anunciada y resultado del fixture elegido.
2. Sin plan: plan null, items/warnings vacíos y contadores cero; mensaje y CTA al planificador existente. No significa lista comprada.
3. Plan vacío: plan presente e items vacíos sin warnings; explicar ausencia de ingredientes, sin productos inventados ni porcentaje ficticio.
4. Lista: lista semántica, check nativo etiquetado con producto/cantidad, contador X de Y marcados y progreso accesible. Con cero items no dividir por cero.
5. Parcial: warnings visibles aunque no haya items o todos estén marcados. Explicar comidas sin receta/ingredientes inválidos con datos disponibles, sin convertir IDs técnicos en nombres inventados. Todos los productos disponibles marcados no implica lista completa.
6. Error: mensaje y Reintentar, transición carga → recuperación. No confundir error con vacío.
7. Sesión vencida: explicación y acción al inicio de sesión existente, distinguida del error genérico; demostrada con fixture de estado del contenedor.
8. Checks demo: emitir set checked boolean por key estable; el contenedor actualiza ese item en memoria y recalcula contadores desde items. Repetir el mismo booleano es idempotente; no acumular deltas. Indicar datos de ejemplo sin afirmar persistencia. Mantener fixtures fuente inmutables.

No incluir costo estimado, PDF, compartir, alta/baja de productos, categorías sin fuente ni consejos no implementados. Sin cambios a landing, dashboard o PWA.

## Accesibilidad y adaptación

Orden: título/semana, avisos, progreso y productos. Controles nativos, etiquetas claras, texto además de color, foco visible y estable al marcar, Tab/Shift+Tab/Espacio y anuncios de carga/error/recuperación sin leer toda la lista en cada check. Distinguir productos homónimos con distintas unidades. Tamaños táctiles suficientes y texto largo con ajuste de línea.

Móvil en columna sin scroll horizontal; tablet aprovecha ancho manteniendo orden y controles; desktop según referencia Terra. Mismo contenido, orden y semana en todos los tamaños. Validar texto aumentado, nulls, advertencias y nombres largos.

## Historias y aceptación

- Como comprador identifico semana, productos y cantidades sin perder diferencias de unidad en desktop/tablet/móvil.
- Con datos incompletos distingo cantidad no disponible, lista parcial, sin plan y plan sin ingredientes; los warnings permanecen visibles con progreso total o cero items.
- Con teclado/lector navego, marco/desmarco, conozco progreso y recupero errores con foco predecible.
- Como integrador reutilizo tipos/vista en NUT-90 cambiando el contenedor, sin duplicar UI.

## Fixtures y pruebas requeridas

Fixtures C: semana con checks mixtos, segunda semana, sin plan, plan vacío, parcial con quantity/unit null, receta faltante sin items, ingredientes inválidos, nombres largos, g/kg separados y decimales hasta 3 posiciones. Loading/error/sesión son estados del contenedor, no extensiones del DTO.

Tester crea pruebas rojas antes del implementador. Cubrir contrato/nulabilidad/códigos/orden; cantidades null y formato; ausencia de agregación/conversión; sin plan vs vacío vs parcial; warnings con todos los checks/cero items; cambio de semana y límites mes/año sin dependencia de zona horaria; set boolean idempotente, resumen desde items e inmutabilidad; error/reintento/recuperación; sesión/CTA/navegación; teclado, etiquetas, foco y anuncios.

Evidencia desktop/móvil y adaptación tablet: estados relevantes, controles táctiles, nombres largos y sin overflow. Checks de tipos/build y regresión acotada a compras/entrada de ruta. Documentar si no se ejecuta lector manual, sin atribuir esa evidencia a tests semánticos. Cuatro lentes de revisión conforme al workflow. Ninguna prueba se ejecuta en esta planificación.

## NUT-90 y estrategia de base de datos

Aquí no hay HTTP, cookies, sesión real ni persistencia. NUT-90 integra GET /shopping-list?weekStart= y PATCH /shopping-list/items/:itemKey con apiClient y credentials. Envía planId, planUpdatedAt ISO original y checked, sin userId. Maneja 401 y 409 SHOPPING_LIST_STALE con recarga/nueva interacción, sin reaplicar intención a otro item.

Sin Prisma/SQL/migraciones ni llamadas a base de datos en este ticket. No implementar ShoppingItemCheck ni agregación; no migrar Recipe.ingredients JSON ni inventar porciones. Backend conserva responsabilidad por firmas, normalización, transacciones y cascadas. Migraciones futuras requieren revisión TL y validación en base de desarrollo.

## Secuencia y presupuesto estimado

| Etapa | Horas previstas | Resultado |
|---|---:|---|
| Referencias y aprobación PO | 0,5 | Estados nuevos aprobados |
| Exploración acotada, tipos, fixtures y pruebas rojas | 0,75 | Plan concreto y comportamiento reproducible |
| Vista, entrada de compras y estados | 1,5 | UI navegable responsive con fixtures |
| Pruebas verdes y evidencia responsive/teclado | 0,75 | Evidencia de criterios y límites |
| Cuatro revisiones, ajustes y handoff | 0,5 | Entrega para NUT-90 |
| Total | 4 | 4 puntos previstos |

Próxima etapa: explorer localiza entrada de compras, Terra, calendario, navegación y herramientas de pruebas y genera plan concreto fechado. Luego tester → implementer → cuatro revisores. Handoff con versión probada, fixtures, evidencia desktop/móvil/tablet, resultados/limitaciones y GET/PATCH pendiente en NUT-90. No modificar estado de Linear ni registrar horas inferidas. Si faltan referencias o la aprobación implica más alcance, escalar/reestimar.

## Contexto operativo

Se leyeron instrucciones disponibles, arquitectura, calidad, frontend, compras y skills de contexto, Stitch, guía web y backlog. El inventario de bibliotecas y las instrucciones de bundle referenciados no existen en este checkout; se usaron instrucciones instaladas del rol diseñador. Sin bibliotecas MCP ajenas al rol. Recuperar guía web actual antes de escribir código cliente. Acceso Stitch/Linear pendiente limita validación visual, no la planificación.
