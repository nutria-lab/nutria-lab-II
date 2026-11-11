# Diseño: instalación básica de NutrIA como PWA

## Decisión

Preparar la aplicación web existente para que los navegadores compatibles permitan instalarla con el nombre y el isotipo de NutrIA y abrirla en modo independiente. La primera entrega cubre el manifiesto, los metadatos de instalación y los recursos de icono optimizados desde el isotipo aportado por producto.

La entrega no promete funcionamiento sin conexión. No se añadirá un service worker salvo que la etapa de exploración confirme que un requisito de instalación verificable de los navegadores objetivo lo exige. La guía actual de MDN indica que no se necesita un service worker para la instalación básica; sí requiere un manifiesto, contexto HTTPS (o localhost durante desarrollo) y miembros/iconos válidos. La compatibilidad exacta y el mecanismo para instalar dependen del navegador y sistema operativo.

## Arquitectura y límites

- La aplicación continúa siendo una SPA React/Vite y conserva su alojamiento y flujo de navegación actuales.
- El manifiesto describe NutrIA con nombre y nombre corto `NutrIA`, URL inicial `/`, ámbito `/` si la aplicación se sirve desde la raíz del dominio, y modo `standalone`.
- Se enlaza el manifiesto desde el documento HTML de entrada. Los metadatos de color de tema y fondo siguen la identidad Terra ya usada por la aplicación.
- Se preparan iconos PNG de 192×192 y 512×512 a partir del isotipo entregado. Se conserva la transparencia si el archivo fuente la contiene y se garantiza un fondo opaco adecuado para los contextos que lo requieran sin alterar el dibujo. El icono solo se declara `maskable` después de verificar que el arte cabe dentro de la zona segura; de lo contrario se publica con propósito `any` y se crea una variante con margen seguro.
- Para el flujo de instalación de iOS se valida el comportamiento con el icono y metadatos de plataforma que requiera Safari, sin prometer un prompt automático. En iOS la instalación se inicia desde el menú de compartir del navegador.
- No se añade botón propio de instalación en la interfaz inicial. Se puede considerar en otra historia si se requiere una invitación de instalación guiada; los mecanismos de prompt no son uniformes entre plataformas.
- Se reutilizan los activos visuales del usuario; no se cambia la marca, el router, las páginas, la autenticación ni el backend.

## Flujos

1. **Visita web:** la persona abre NutrIA bajo HTTPS. El navegador obtiene el manifiesto y los iconos y muestra su acción de instalación cuando la plataforma lo permita.
2. **Instalación en escritorio o Android:** la persona acepta la acción nativa del navegador. El sistema registra NutrIA con su nombre e icono; al abrirla inicia la ruta raíz y presenta una ventana independiente.
3. **Instalación en iOS/iPadOS:** la persona usa “Añadir a pantalla de inicio” desde Safari. Se valida el nombre, el icono y la apertura en modo independiente según soporte de la versión del sistema.
4. **Desarrollo local:** se acepta localhost/loopback como contexto seguro. No se interpreta que localhost pruebe el certificado o configuración HTTPS de producción.
5. **Recursos no disponibles:** no se promete acceso offline. Si la red falla, la aplicación conserva su comportamiento web actual y muestra los estados existentes.

## Historia de usuario

Como persona usuaria de NutrIA, quiero añadir la aplicación a la pantalla de inicio o al escritorio con su isotipo y abrirla en una ventana independiente, para encontrarla y volver a ella como una aplicación.

## Criterios de aceptación

- Un manifiesto válido se enlaza desde la página de entrada y el navegador puede obtenerlo con tipo de contenido JSON adecuado.
- El manifiesto identifica NutrIA, define URL inicial y ámbito coherentes con el dominio raíz de despliegue, y solicita modo `standalone`.
- Están disponibles iconos PNG cuadrados de 192×192 y 512×512 que se derivan del isotipo entregado, se leen correctamente y conservan la transparencia/intención visual apropiada.
- Ningún icono se declara `maskable` sin verificar su zona segura en máscaras comunes; su aspecto se revisa en recorte redondo y cuadrado.
- La instalación funciona desde una URL HTTPS de preview o producción en al menos un navegador de escritorio y uno móvil objetivo. Se registra la versión de navegador y dispositivo usados.
- Después de instalar, la app abre su ruta raíz en modo independiente donde la plataforma lo admite; las rutas internas de SPA continúan funcionando dentro del ámbito.
- El alcance está limitado al dominio raíz. Si el despliegue efectivo vive bajo un prefijo, se ajustan conjuntamente `start_url`, `scope` y recursos antes de liberar; no se deja una combinación que excluya la ruta inicial.
- Vite local puede validar la lectura del manifiesto y los iconos, pero el criterio de HTTPS de producción se acredita en una URL servida por TLS.
- No se afirma disponibilidad offline ni actualización mediante service worker.

## Pruebas y evidencia requeridas

- Validación automatizada del JSON y de los miembros, valores, rutas y relación entre `start_url` y `scope`.
- Comprobación automatizada de que cada icono referenciado responde correctamente, es PNG y tiene las dimensiones declaradas; revisión visual del resultado, transparencia/fondo y márgenes de seguridad.
- Build y preview de producción para confirmar que los recursos estáticos quedan publicados bajo las rutas del dominio.
- Inspección en Chromium desktop y Android (o emulación representativa) y Safari iOS real cuando esté disponible: instalación, nombre, icono, modo de apertura y navegación directa a una ruta interna.
- Registrar límites por plataforma y cualquier paso manual requerido en iOS. Una auditoría de manifiesto por sí sola no acredita la instalación final.
- No se requieren pruebas de base de datos ni mutaciones de dominio para este cambio.

## Persistencia y migraciones

Sin cambios de Prisma, SQL, Neon, API ni almacenamiento de datos. El manifiesto y los iconos son recursos estáticos publicados con el frontend. No se cachean datos de sesión ni contenido autenticado.

## Riesgos y decisiones para exploración

- **Alcance de alojamiento:** las rutas absolutas `/` presuponen que la SPA se publica en la raíz del dominio. Confirmar dominio y `base` real de Vite/Vercel antes de implementar; un hosting en subdirectorio requiere rutas relativas o un ámbito distinto.
- **Isotipo y transparencia:** confirmar dimensiones, canal alpha y bordes del PNG fuente. Su representación visual muestra un medallón circular, pero el fondo exterior puede ser transparente; no convertir accidentalmente esa transparencia en negro. El peso fuente reportado (2,36 MB) debe reducirse en los derivados sin degradar el arte.
- **Máscaras del sistema:** el icono circular puede dejar márgenes o recortes no deseados bajo distintas máscaras. `maskable` requiere una variante con composición y zona segura verificadas.
- **Compatibilidad:** instalación y metadatos de iOS difieren de Chromium; probar Safari en dispositivo real y documentar la alternativa nativa de “Añadir a pantalla de inicio”.
- **Instalabilidad frente a offline:** no confundir el manifiesto y modo independiente con una estrategia offline. Un service worker añade políticas de caché, versionado e invalidación y queda fuera de esta entrega.
- **Contexto TLS:** certificados/proxy/headers de preview y producción deben ser válidos. El éxito en localhost no acredita HTTPS.
- **Identidad visual:** tomar colores del tema Terra y del arte existente; el PO debe aprobar cualquier fondo añadido al activo si cambia la marca percibida.

## Fuentes consultadas

- MDN, [Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable): manifiesto, iconos mínimos de Chromium, HTTPS/localhost y ausencia de requisito general de service worker.
- MDN, [Manifest start_url](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/start_url) y [scope](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/scope): relación entre URL de inicio y ámbito.
- Google Modern Web Guidance se debe consultar de nuevo durante implementación según la skill frontend del proyecto.

## Restricciones del proceso

Esta etapa solo establece el diseño; la exploración siguiente identificará ubicaciones concretas. En este checkout no existen las rutas indicadas por las instrucciones para el inventario de librerías de agentes ni las instrucciones del bundle de desarrollo; se leyeron las skills instaladas de contexto de NutrIA y guidance web moderno, junto con las guías de arquitectura, calidad y frontend requeridas.
