# NUT-90 — Archivos propuestos para la implementación

Generado: 2026-10-26 01:40:47 UTC.
Complementa [plan.md](plan.md) y [evidence.md](evidence.md). El inventario corresponde a la implementación aplicada; evidence.md registra verificaciones y pendientes.

## Archivos a crear

| Archivo | Responsabilidad |
|---|---|
| `apps/web/src/services/shoppingListService.ts` | GET por semana y PATCH por key mediante `apiClient`; payload exacto, token original, señales de cancelación, guard de vigencia y timeouts. Validar respuestas antes de confirmarlas a la UI. |
| `apps/web/src/services/tests/shoppingListService.test.ts` | Verificar URLs, query/body, credenciales heredadas, token intacto, cancelación, respuestas inválidas y propagación de errores HTTP. |
| `apps/web/src/modules/shopping-list/hooks/useShoppingList.ts` | Cargar datos reales; administrar snapshot confirmado, pendientes e intenciones por item; bloquear doble envío; reconciliar conflictos; descartar respuestas fuera de sesión/semana/generación. |
| `apps/web/src/modules/shopping-list/hooks/tests/useShoppingList.test.ts` | Probar promesas diferidas, concurrencia entre items, reintento absoluto, 409 con reconciliación única, cambio de semana/usuario, desmontaje y respuestas fuera de orden. |
| `.plans/nut-90-shopping-list-integration/evidence.md` | Completar durante la implementación con versión probada, criterios, comandos/resultados reales, evidencia responsive, aprobaciones y limitaciones. No registrar horas inferidas. |

## Archivos existentes a modificar

| Archivo | Cambio previsto |
|---|---|
| `apps/web/src/modules/shopping-list/pages/ShoppingListPage.tsx` | Sustituir fixtures y temporizadores por el hook; integrar `useAuth` como contexto local y `useSearchParams` para semana; mantener la ruta real existente. |
| `apps/web/src/modules/shopping-list/components/ShoppingListView.tsx` | Recibir pendientes, errores por item y aviso de conflicto; mantener encabezado/selector en carga; eliminar aviso demo y conservar estados sin plan/vacío/parcial. |
| `apps/web/src/modules/shopping-list/components/ShoppingListItem.tsx` | Incorporar estado de guardado, bloqueo accesible con foco estable, error y reintento explícito. Reservar espacio para avisos y conservar el valor confirmado hasta respuesta del servidor. |
| `apps/web/src/modules/shopping-list/types.ts` | Mantener el DTO C exacto; agregar `ShoppingListCheckRequest`, `ShoppingListCheckResponse` y tipos locales de pendientes/errores separados del DTO. |
| `apps/web/src/modules/shopping-list/utils.ts` | Reutilizar validación y aritmética calendario; agregar obtención del lunes actual desde fecha de Buenos Aires, independiente de la zona horaria del navegador. |
| `apps/web/src/modules/shopping-list/fixtures/shoppingList.fixture.ts` | Conservar escenarios deterministas para pruebas; adaptar UUID y keys que participen en pruebas de integración al contrato real. No importar fixtures desde el contenedor de producción. |
| `apps/web/src/modules/shopping-list/pages/tests/ShoppingListPage.test.tsx` | Cambiar la fuente de datos simulada a HTTP/servicio; probar query param, carga, recarga, semanas y coordinación con sesión. |
| `apps/web/src/modules/shopping-list/components/tests/ShoppingListView.test.ts` | Extender cobertura de estados inline, contador confirmado, conflicto y warnings persistentes. |
| `apps/web/src/modules/shopping-list/tests/utils.test.ts` | Agregar fechas de Buenos Aires y límites de mes/año, manteniendo pruebas de fechas reales y lunes. |
| `apps/web/src/services/apiClient.ts` | Agregar callback opcional `isRequestCurrent?: () => boolean` en la configuración Axios; consultar su vigencia antes del manejador global de 401/403. No serializarlo. Por defecto conservar el comportamiento actual. |
| `apps/web/src/services/tests/apiClient.test.ts` | Verificar que errores de solicitudes invalidadas no cierren una sesión nueva y que solicitudes vigentes sigan usando el manejo global deduplicado. |
| `apps/web/src/features/auth/tests/AuthProvider.test.tsx` | Extender regresión de logout/login y 401 tardío en coordinación con requests de compras, sin modificar el flujo global de sesión. |

## Interfaces locales propuestas

```ts
type ShoppingListRequestOptions = {
  signal: AbortSignal;
  isRequestCurrent: () => boolean;
};

shoppingListService.getForWeek(
  weekStart: string,
  options: ShoppingListRequestOptions,
): Promise<ShoppingListResponse>;

shoppingListService.setItemChecked(
  itemKey: string,
  input: ShoppingListCheckRequest,
  options: ShoppingListRequestOptions,
): Promise<ShoppingListCheckResponse>;
```

`isRequestCurrent` es una guarda local para callbacks e interceptor, no un campo de autenticación enviado al backend. El hook entrega a la página el estado de lectura, la respuesta confirmada, pendientes/errores por key, aviso de conflicto y las acciones `reload`, `setChecked` y `retryItem`. La página conserva la semana en URL y la pasa al hook junto con el contexto de sesión.

## Referencias existentes y límites

- Reutilizar `apps/web/public/fixtures/shopping-list.json` como referencia de payload producido por backend; sus pruebas existentes contrastan el contrato del productor.
- Mantener la ruta `/shopping-list` y la protección de `App`; no se necesita otra ruta ni una pantalla demo.
- Backend, Prisma y migraciones permanecen fuera del cambio de este ticket. Si aparece una incompatibilidad real, documentarla y escalarla antes de ampliar el alcance.
- No agregar infraestructura E2E nueva dentro de las 4 h sin revisar presupuesto. Usar pruebas de componentes/servicio y verificación integrada con API de desarrollo; documentar las evidencias responsive y los casos que no puedan ejecutarse.

