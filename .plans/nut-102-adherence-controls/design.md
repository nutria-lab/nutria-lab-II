# NUT-102 — Diseño de controles de adherencia

Fecha: 2026-10-22. Estado: propuesta Terra validada por el usuario/PO. Autorización explícita recibida por el coordinador: «Valido la propuesta Terra; continuar sin Stitch».

## Contexto y decisión

Entregar un control presentacional reutilizable para completar, omitir o deshacer el registro de una comida, con fixtures tipados. FE1: 2 h / 2 puntos, descontadas de NUT-93, sin sumar alcance ni capacidad. La entrega acredita el componente con fixtures; la integración real corresponde a NUT-93 y el flujo final a NUT-99.

Decisión reversible: componente controlado con tres botones, estado confirmado visible y callbacks de intención. El contenedor conserva la fuente de verdad y el ciclo de petición. No realizar selección optimista, navegación, persistencia, efectos HTTP ni inferencias desde recetas, compras o calorías. Un checkbox binario no distingue los tres estados; un selector oculto dificulta reconocer las acciones.

## Arquitectura y contrato público

Props exportadas y documentadas:

```ts
type MealCompletionStatus = 'NOT_LOGGED' | 'COMPLETED' | 'SKIPPED';
type MealAdherenceControlProps = {
  meal: AdherenceResponse['days'][number]['meals'][number];
  pending: boolean;
  error: string | null;
  onSetStatus: (status: MealCompletionStatus) => void;
};
```

Conservar literalmente todos los nombres, nulabilidad y enums del contrato A. La comida contiene plannedMealId, mealUpdatedAt, recipeId nullable, mealType, title, status y canEdit. No agregar fecha, causa de bloqueo o campos de transporte. No recalcular canEdit con el reloj del cliente. NUT-93 integra cookie, GET/PUT, invalidación, 401 y 409. No modificar router, dashboard, landing ni la composición del plan en este ticket.

## Propuesta Terra validada, flujos e historias

Mostrar título de comida, leyenda «Registro de comida», estado actual y botones «Completada», «Omitida», «Sin registrar». Mapearlos a COMPLETED, SKIPPED y NOT_LOGGED. Selección distinguible con texto/semántica además de color: verde bosque para completada, ámbar moderado para omitida y neutral para sin registrar. Terra existente: crema, elevación suave, Literata y Nunito Sans.

1. Como persona con plan, reconozco el estado actual y activo otro estado. Elegir el seleccionado es una operación sin callback.
2. Completar y omitir son acciones explícitas; «Sin registrar» deshace cualquiera de ambas marcas.
3. Mientras pending=true, conservar selección confirmada, mostrar/anunciar «Guardando…» y bloquear todas las activaciones adicionales.
4. Al recibir nuevas props de éxito, actualizar y anunciar el estado confirmado; no simular éxito antes.
5. Ante error, mantener selección, mostrar el error como texto escapado y anunciarlo. Cuando pending=false y canEdit=true, permitir volver a elegir la intención fallida u otro estado. El contenedor controla limpieza del error; no recordar un destino interno para añadir un reintento.
6. Con canEdit=false, bloquear acciones y mostrar «Esta comida no está disponible para registrar cambios. Solo se pueden registrar comidas de hoy o anteriores del plan vigente.» La segunda frase explica la regla de elegibilidad; no afirma una causa individual ni invalida semanas pasadas. No agregar un prop de motivo ni inferir fechas.

## Accesibilidad y responsive

Botones nativos type=button en un grupo con nombre que incluya el título de la comida. aria-pressed expresa el estado seleccionado. No usar radios sin su navegación por flechas. aria-disabled expresa pendiente o no editable; los manejadores bloquean clic, Enter y Espacio en esos casos. Conservar foco al entrar en pendiente/error y actualizar props; mantener la misma estructura DOM. Asociar la explicación de bloqueo mediante descripción accesible.

Región estable de estado para guardado/cambio confirmado y role=alert para error, sin anunciar simultáneamente el mismo mensaje en dos regiones. Foco visible contrastado, semántica y texto además de color, contraste AA y orden natural. No anidar este grupo en un enlace o botón de tarjeta.

Acciones con altura mínima 44 px. Tres columnas cuando el ancho propio del control permita al menos 28 rem; bajo ese ancho apilar a ancho completo. Preferir flex/grid con ajuste intrínseco, sin depender solo del viewport: un control puede vivir en una columna estrecha en desktop. Evidencia a 390 px móvil, 768 px tablet y 1440 px desktop; comprobar 320 px y zoom 200 %, título/error largos y ausencia de overflow. Mantener etiquetas y orden en todos los tamaños.

## Criterios de aceptación

- Los tres enums se muestran correctamente y tienen estado seleccionado accesible.
- Elegir otro estado llama una vez al callback con el enum exacto; elegir el actual no llama; nunca mutar meal.
- Pending bloquea toda acción, anuncia guardado y conserva la selección confirmada; nuevas props determinan la recuperación.
- CanEdit=false bloquea toda acción y expone la explicación visible y accesible sin derivar autorización del cliente.
- Error anunciado, selección conservada y recuperación por nueva elección cuando termina el pendiente.
- Flujo completo con teclado y foco visible/conservado; botones no envían formularios ancestros.
- Contrato y props documentados, fixtures tipados sin any ni casts que oculten errores.
- Evidencia desktop/móvil y adaptación tablet del componente con fixtures; no acreditar funcionalidad integrada.

## Pruebas y fixtures requeridos

El tester crea primero pruebas fallidas por ausencia del componente y reporta rojo; luego se implementa el mínimo y se reporta verde. Respetar sus extensiones de escritura permitidas; si no admiten JSX, usar creación de elementos React.

Pruebas: tres estados parametrizados; nombres accesibles/grupo/aria-pressed; callbacks de completar/omitir/deshacer; no callback sobre estado actual; clic y teclado bloqueados en pending y no editable; explicación de bloqueo; rerender pendiente-éxito y pendiente-error-recuperación; cero selección optimista/mutación; foco conservado; type=button; múltiples instancias sin colisión de identificadores accesibles. Dos activaciones después de pending=true no envían callbacks: el contenedor debe activar pendiente al iniciar petición.

Fixture de respuesta completa del contrato A con tres estados, recipeId=null, comida no editable y comida editable de semana pasada vigente; variantes de presentación pending/error. Incluir muestras sin plan (plan:null, days:[], contadores cero) y cero comidas (adherencePercent:null) para handoff sin agregar una vista vacía al componente que exige meal. No implementar cálculos porcentuales. Si el entorno de evidencia muestra un resumen contextual, usar «Progreso de la semana» sin penalizar días futuros.

Evidencia visual implementada en los tres tamaños para estados normal, pendiente, error y bloqueado; revisar teclado, contraste, foco, zoom y texto largo. Un mockup no acredita el componente terminado.

## Prisma, base de datos, migración y reversión

Sin cambios Prisma, migraciones, seeds, SQL, NestJS, Neon u OpenAI. Persistencia y concurrencia pertenecen a los tickets de backend; no modificar migraciones aplicadas. Revertir el componente y sus fixtures no afecta datos ni HTTP. No se introduce una decisión material de arquitectura que requiera un ADR separado.

## Evidencia de diseño, excepciones y handoff

Se leyó el registro central de enlaces del proyecto. Stitch respondió Authentication required al listar pantallas: no se pudo inspeccionar frames ni generar un artefacto nuevo y no se afirma aprobación previa de frames nuevos. El usuario validó explícitamente esta propuesta Terra y autorizó continuar sin Stitch; se conserva esa excepción para el handoff. Implementar a partir de Terra existente y obtener evidencia visual real del componente.

No están instalados el catálogo de bibliotecas ni el workflow de bundle referidos por el rol; se usaron el rol frontend-designer instalado y las skills pertinentes de contexto, Stitch, arquitectura y guía web. Google Modern Web Guidance devolvió código -1 sin salida; el coordinador confirmó el mismo resultado en reintentos y permisos alternativos. Registrar la limitación y recurrir a documentación primaria accesible para patrones de botones/foco cuando sea necesario; no afirmar guía recuperada.

Siguiente etapa: explorer localiza límites concretos y escribe el plan con timestamp, antes del tester. La validación PO y excepción Stitch ya están otorgadas; no se requiere repetir esa aprobación.

Entorno de evidencia: se permite un preview de desarrollo aislado, alimentado exclusivamente por fixtures, con un contenedor mínimo que cambia las props para reproducir pendiente, éxito y error. Debe ser accesible por una entrada de desarrollo independiente, sin modificar el router ni presentarse como una página integrada de producto. No realiza HTTP y no persiste datos. Sirve para revisión y capturas desktop/tablet/móvil; el explorer elegirá el mecanismo más pequeño compatible con las herramientas existentes.

Fallback documental: el coordinador recuperó fuentes primarias Google web.dev sobre foco/JavaScript y W3C sobre el patrón de botones. Registrar sus referencias precisas en la evidencia de implementación; no inventar IDs de Google Modern Web Guidance.
