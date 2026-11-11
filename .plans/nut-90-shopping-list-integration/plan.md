# NUT-90 — Sincronizar la lista de compras con el backend

Generado: 2026-10-26 01:40:47 UTC (2026-10-25 en America/Argentina/Buenos_Aires).
Estado: implementación aplicada; ver resultados y pendientes en evidence.md.
Mapa de archivos: [files.md](files.md).

## Resultado y alcance

Integrar GET/PATCH del contrato C sobre la pantalla de NUT-89 para consultar ingredientes reales y conservar los checks al recargar.

Responsable: **Fer Cesio (FE1)**. Estimación: **4 h / 4 puntos previstos**, durante el **22–28/10**, con vencimiento **2026-10-28**. Incluye implementación, revisión y pruebas; no representa horas registradas. Trabajo sin subagentes por instrucción del usuario.

Sprint 3: 15/10–11/11/2026. Capacidad de 72 h, compromiso de 57 h y 15 h libres; máximo 6 h por developer por semana. Este plan no modifica asignación, capacidad, fechas ni estado de Linear.

El backend inspeccionado ya contiene los endpoints y la persistencia de NUT-88. Este ticket no requiere cambios de Prisma, migraciones ni agregación de ingredientes en frontend. Confirmar su disponibilidad en el entorno de desarrollo antes de la verificación integrada.

## Integración y manejo del estado

- Crear `shoppingListService` usando `apiClient` y sus cookies con `withCredentials`. Exponer lectura por `weekStart` y escritura por `itemKey`, con cancelación y tiempos máximos de 10 segundos para GET y 45 segundos para PATCH.
- Conservar `ShoppingListResponse` sin modificar el contrato. Agregar los tipos de solicitud y respuesta PATCH: `{ planId, planUpdatedAt, checked }` y `{ itemKey, checked }`. Enviar el ISO original recibido, sin reconstruirlo; ningún request incluirá `userId`.
- Reemplazar los fixtures y temporizadores de `ShoppingListPage` por un hook `useShoppingList`. Mantener los fixtures como datos deterministas de pruebas, usando UUID y keys compatibles con el productor.
- Guardar la semana seleccionada en `?weekStart=YYYY-MM-DD`. Si falta, usar el lunes de la fecha actual en `America/Argentina/Buenos_Aires`. Validar fecha real y lunes; un parámetro inválido se reemplazará por esa semana antes de consultar.
- En entrada, recarga o cambio de semana, ejecutar GET. Mantener encabezado y selector visibles durante la carga, sin mostrar productos de otra semana. Conservar orden, cantidades, unidades y warnings recibidos.

Cada solicitud tendrá una identidad de sesión, semana y generación de carga. Las mutaciones capturarán además `planId`, `updatedAt` y `itemKey`. Ignorar respuestas fuera de contexto y cancelar lecturas anteriores. Una finalización antigua no podrá liberar el bloqueo de una solicitud nueva para la misma key.

Para evitar que un `401` tardío cierre una sesión nueva, incorporar un guard opcional de vigencia al interceptor de `apiClient`. Se evaluará antes del manejo global de autenticación y no se enviará al servidor. Las solicitudes vigentes conservarán el flujo actual de `AuthProvider`; este ajuste tendrá revisión TL.

### Contrato HTTP

```ts
GET /shopping-list?weekStart=2026-10-19

type ShoppingListResponse = {
  weekStart: string;
  plan: { id: string; version: number; updatedAt: string } | null;
  items: Array<{
    key: string;
    name: string;
    quantity: number | null;
    unit: string | null;
    checked: boolean;
    sources: Array<{
      plannedMealId: string;
      recipeId: string;
      ingredientIndex: number;
      quantity: number | null;
      unit: string | null;
    }>;
  }>;
  summary: { totalItems: number; checkedItems: number };
  warnings: Array<{
    code: 'MISSING_RECIPE' | 'INVALID_INGREDIENT';
    plannedMealId: string;
    ingredientIndex?: number;
  }>;
};

PATCH /shopping-list/items/:itemKey

type ShoppingListCheckRequest = {
  planId: string;
  planUpdatedAt: string;
  checked: boolean;
};

type ShoppingListCheckResponse = {
  itemKey: string;
  checked: boolean;
};
```

La key se consume como identificador opaco; el productor actual entrega hashes hexadecimales de 64 caracteres. No generarla ni normalizarla en frontend. No agregar categorías, fusionar ingredientes, convertir unidades, inventar porciones ni copiar checks entre versiones. `g` y `kg` permanecen separados. Mantener cantidades null y warnings explícitos.

## Checks, errores y propuesta visual

Opción elegida por el usuario: **avisos inline Terra**, conservando la estructura desktop/móvil de NUT-89 y su adaptación tablet. Presentar los nuevos estados de guardado, reintento y conflicto para aprobación PO antes de cerrar su implementación visual. La elección de enfoque no constituye esa aprobación.

- **Guardar:** enviar el booleano absoluto. Mantener el check y contador confirmados mientras PATCH está pendiente. Bloquear nuevos envíos del mismo item mediante una guarda inmediata, conservar el foco y mostrar «Guardando…» en un espacio reservado.
- **Éxito:** actualizar únicamente la key confirmada por el backend y recalcular `summary` desde `items`. Permitir guardar otros productos en paralelo mediante actualizaciones funcionales. Una respuesta inválida no confirma la operación.
- **Red, timeout o 500:** conservar el valor anterior y mostrar error por fila con «Reintentar». El reintento explícito repetirá el mismo booleano, key y token mientras pertenezcan al contexto vigente. No implementar reintentos automáticos de escritura.
- **409 `SHOPPING_LIST_STALE`:** descartar intenciones y reintentos del snapshot anterior, bloquear temporalmente sus checks y explicar que cambió el plan. Dejar resolver las escrituras ya iniciadas y ejecutar un único GET de reconciliación. Pedir una nueva interacción; nunca reaplicar la marca automáticamente.
- **404 al guardar:** informar que el producto ya no está disponible y recargar, sin revelar información de otros usuarios.
- **400 o respuesta inválida:** conservar el estado confirmado y mostrar un error de operación; no tratarlo como lista vacía. Distinguir los estados por status y códigos, sin depender del texto del servidor.
- **401 vigente:** delegar al flujo global de sesión y limpiar datos e intenciones locales.

Al cambiar semana, usuario o desmontar la pantalla, invalidar callbacks y reintentos anteriores. No guardar checks en almacenamiento del navegador. Conservar la distinción entre sin plan, plan vacío y lista parcial, incluso con cero productos o todos marcados. Eliminar el aviso de datos de ejemplo en la ruta real.

Referencias visuales suministradas por el usuario:

- Desktop: proyecto Stitch `5785725448623770239`, pantalla `6385727a13cc465184ca372561d1251e`.
- Móvil: proyecto Stitch `5785725448623770239`, pantalla `1a56b1652bc240599fd44ce825b40bb8`.

Conservar Terra: verde bosque, crema cálido, acentos ámbar, Literata en títulos y Nunito Sans en cuerpo. No incorporar precios, PDF, compartir ni alta/baja de productos por aparecer en un frame de referencia.

## Pruebas y criterios de cierre

Preparar pruebas de comportamiento antes de integrar:

- GET/PATCH exactos, credenciales, token original y ausencia de `userId`.
- UI sin confirmación anticipada; doble envío bloqueado por item; escrituras de distintos items sin perder actualizaciones.
- Error seguido de reintento explícito e idempotencia del booleano.
- `409` con recarga única y ninguna reaplicación automática, incluyendo otras escrituras pendientes.
- Respuestas tardías después de cambiar semana, sesión o plan; un `401` anterior no invalida una sesión nueva.
- Persistencia mediante API de desarrollo: marcar, recargar, volver a la semana y verificar aislamiento entre dos usuarios. Regenerar el plan no transfiere checks.
- Teclado, foco, anuncios y espacio estable para estados; evidencia en **390 px, 768 px y 1280 px**.
- Fechas inválidas, fechas que no son lunes, límites de mes/año y selección consistente bajo distintas zonas horarias del navegador.

Ejecutar pruebas enfocadas de servicio/hook/componentes y regresión de autenticación afectada, TypeScript y build. Conservar evidencia de estados responsive; no atribuir pruebas manuales de lector de pantalla a verificaciones semánticas automatizadas. Antes de código cliente, obtener Google Modern Web Guidance conforme a la skill del proyecto.

Comandos previstos desde `apps/web`:

```powershell
npm.cmd test -- src/modules/shopping-list src/services/tests/shoppingListService.test.ts src/services/tests/apiClient.test.ts src/features/auth/tests/AuthProvider.test.tsx
npm.cmd run build
```

Completar revisión manual de riesgo, legibilidad, fiabilidad y resiliencia sin subagentes; resolver hallazgos bloqueantes antes del handoff. La revisión TL del guard de autenticación y la aprobación PO de nuevos estados son requisitos de cierre.

## Distribución prevista y entrega

| Trabajo | Horas previstas |
|---|---:|
| Validar contrato y propuesta inline con PO | 0,50 |
| Servicio y pruebas iniciales | 0,75 |
| Hook, PATCH y protección de contextos | 1,25 |
| Estados visuales y accesibilidad | 0,50 |
| Verificación, revisión y handoff | 1,00 |
| **Total** | **4,00** |

Entregar versión probada, fixtures y evidencia vinculada al ticket. Si aparece una diferencia de contrato o el diseño aprobado supera estas 4 h, escalar antes de ampliar el alcance. No cambiar estado de Linear ni registrar horas reales inferidas.

## Fuentes y límites de la planificación

- Fuente de alcance: descripción completa de NUT-90 pegada por el usuario y elección de avisos inline Terra.
- Plan de sprint referenciado: https://linear.app/nutria-lab2/document/sprint-3-capacidad-y-distribucion-semanal-de05ffa684f5. No fue accesible durante la investigación; no se afirma haberlo validado.
- Inspección local: UI y tipos de NUT-89; `apiClient` y `AuthProvider`; controller, servicio, repositorio, errores y DTOs del backend de compras; fixture público producido por el backend.
- CodeGraph tenía directorio local pero no un comando/MCP utilizable. Se usó búsqueda local acotada como alternativa.
- No se ejecutaron pruebas nuevas ni se verificó un despliegue para preparar este plan. La evidencia previa de NUT-89 no acredita la integración de NUT-90.

