# Diseño: recuperación de generación de planes ante `MISSING_FIELD`

## Alcance y evidencia

En la ejecución reportada del 9 de noviembre de 2026, varias llamadas al proveedor terminaron con éxito de transporte, pero la validación de una receta rechazó la salida con `MISSING_FIELD` y el endpoint devolvió 422. Los avisos `KPI_WRITE_WAIT_EXCEEDED` son fallos de espera en telemetría y no demuestran que hayan causado el rechazo. La traza no identifica el campo faltante ni contiene la respuesta estructurada, por lo que la causa precisa sigue sin confirmarse.

Suposición de trabajo: un candidato de receta puede estar incompleto aun cuando la llamada al proveedor se complete. La corrección se limita al contrato y manejo de esa salida. No altera restricciones alimentarias, autorización ni composición del plan.

## Decisión y arquitectura

1. Mantener la salida de IA como dato no confiable. La validación estructural y de dominio del servidor sigue siendo la condición previa para guardar o mostrar cualquier receta o plan.
2. Alinear el esquema de respuesta enviado al proveedor, las instrucciones de generación y el validador del servidor con un único conjunto explícito de campos obligatorios. Versionar el contrato si se modifica. No completar campos faltantes con valores inventados, vacíos ni datos de otra receta.
3. Si un candidato falla por campo faltante, registrar un diagnóstico seguro con nombre/ruta del campo, código, etapa, modelo e identificador de ejecución, sin volcar texto de receta ni datos del perfil. Permitir una regeneración acotada del candidato afectado solo si el flujo actual y su presupuesto de tiempo/costo lo admiten; validar nuevamente la respuesta completa. Si persiste el fallo, devolver un error recuperable con reintento del usuario. Evitar un bucle sin límite y evitar repetir recetas ya válidas salvo necesidad de consistencia de composición.
4. Tratar `KPI_WRITE_WAIT_EXCEEDED` como observabilidad independiente. Confirmar mediante pruebas que la espera de escritura de métricas no cambia el resultado de validación ni persiste una salida inválida. Cualquier cambio de latencia de KPI sería otro alcance si no se comprueba un acoplamiento causal.

## Flujo

1. Recibir objetivo, preferencias y restricciones explícitas; capturar contexto de generación.
2. Solicitar cada candidato mediante respuesta estructurada del proveedor.
3. Validar presencia y forma de campos; después aplicar validaciones de restricciones y dominio.
4. Ante `MISSING_FIELD`, emitir diagnóstico sin contenido sensible y ejecutar como máximo el reintento autorizado por el presupuesto configurado.
5. Persistir el plan solo si todos los candidatos pasan; de otro modo cerrar la ejecución con fallo recuperable y motivo estable.

## Historia y criterios de aceptación

Como usuario que genera un plan, quiero que una respuesta incompleta de IA se recupere si es posible y que, si no se recupera, pueda reintentar sin recibir un plan incompleto.

- Una respuesta completa y válida genera el plan esperado.
- Una respuesta con cada campo obligatorio ausente se rechaza, identifica el campo en telemetría segura y no se persiste ni muestra.
- Cuando la regeneración acotada devuelve una receta válida, la generación termina correctamente sin duplicaciones ni violar restricciones.
- Cuando la regeneración también es inválida, se devuelve un estado recuperable con código de validación estable; no hay sustitución fabricada.
- Una restricción alimentaria incumplida sigue fallando aunque estén presentes todos los campos.
- Un aviso de espera de KPI no transforma una salida válida en 422 ni permite aceptar una inválida.
- Los eventos incluyen identificador de ejecución para correlación sin registrar contenido sensible.

## Pruebas requeridas

- Caso determinista con salida válida y caso con campo obligatorio omitido para reproducir el rojo antes de implementar.
- Caso de reintento válido tras `MISSING_FIELD`, fallo repetido, salida vacía y salida malformada.
- Caso de restricción alimentaria incumplida para proteger el límite de seguridad.
- Caso de escritura de KPI que excede su espera durante una generación válida.
- Prueba de no persistencia ni exposición parcial cuando alguna receta del plan falla.

## Prisma y migraciones

No se prevé cambio de modelo, Prisma ni migración. Si la exploración revela que recuperar correctamente requiere persistir un estado nuevo, detener este cambio acotado y registrar una decisión de datos separada bajo el protocolo de dos commits y aprobación humana antes de ejecutar una migración compartida.

## Compatibilidad, evaluación y reversión

El contrato HTTP puede conservar el 422 y su código estable mientras mejora el diagnóstico interno y la recuperación acotada. Evaluar con fixtures deterministas de campos ausentes, restricciones, respuesta vacía y contradicción. Si se cambia prompt o esquema, guardar versión y resultado de evaluación; revertir esa versión si aumenta rechazos o respuestas inseguras. El costo del reintento queda limitado por el presupuesto existente y debe medirse.

## Pendientes de exploración

Determinar el campo realmente ausente, la ruta de validación, el esquema estructurado efectivo, el manejo actual de reintentos y la relación temporal real entre KPI y validación. Localizar la incidencia Linear correspondiente antes de registrar evidencia o tiempo; no hay identificador de incidencia en los datos recibidos.
