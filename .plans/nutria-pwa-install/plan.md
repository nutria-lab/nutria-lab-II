# Plan de exploración: instalación básica PWA de NutrIA

**Generado:** 2026-10-25 20:35 UTC  
**Diseño:** [design.md](design.md)  
**Alcance:** manifiesto, metadatos e iconos estáticos para instalación; no service worker, caché offline, botón de instalación, navegación nueva ni cambios de backend.

## Ubicaciones y símbolos confirmados

| Archivo / símbolo | Hallazgo | Acción prevista para implementación |
|---|---|---|
| `apps/web/index.html`, `<head>` | Documento de entrada HTML de la SPA; ya define idioma, viewport y título NutrIA. | Agregar `<link rel="manifest">`, `theme-color` y los metadatos de icono de Apple que se acuerden en diseño. Mantener el título y viewport existentes. |
| `apps/web/public/` | Vite copia esta carpeta al root de `dist`; hoy contiene únicamente `fixtures/shopping-list.json`. | Añadir `manifest.webmanifest` e iconos PNG estáticos bajo `icons/`. Usar URLs raíz coherentes con la publicación en root. |
| `apps/web/vite.config.ts`, `defineConfig` | Configura React y Tailwind; no declara `base` ni cambia `publicDir`. Aplica el comportamiento predeterminado de Vite (`base: /`, `public`). | No necesita cambio para publicar el manifiesto ni los iconos. Confirmar rutas en `dist` tras `vite build`. |
| `apps/web/vercel.json`, `rewrites` | Vercel tiene rewrite API y fallback general de SPA a `/index.html`. `outputDirectory` es `dist`. | No cambiarlo si Vercel sirve los archivos estáticos existentes antes del fallback. Probar en preview que manifest e iconos se sirven directamente y que el fallback sigue resolviendo rutas SPA. |
| `apps/web/src/main.tsx`, `createRoot` / `BrowserRouter` | Entrada React existente. | No modificar; la PWA conserva la navegación y el punto de inicio actual. |
| `apps/web/src/assets/nutria-icon.png` | Hay un icono de marca dentro de assets de código. | Comparar visualmente con el isotipo nuevo. No usarlo por defecto: el arte de usuario en Desktop es la fuente autorizada para esta entrega. |
| `apps/web/package.json`, scripts `build`, `lint`, `test` | Incluye build, typecheck y Vitest; no hay dependencia PWA ni generador de imágenes identificado. | No añadir un plugin PWA ni un service worker. Usar los comandos existentes; evitar nuevas dependencias solo para servir recursos estáticos. |

## Isotipo entregado

La ruta local `C:\Users\Usuario\Desktop\isotipo (2).png` existe y es legible en este entorno. Tratarla como **fuente de solo lectura**: copiarla al checkout (nunca moverla ni sobrescribirla) antes de producir derivados. No enlazar el manifest a una ruta de Desktop, ya que Vite/Vercel no publican archivos fuera del repositorio.

Ubicación destino sugerida para los derivados: `apps/web/public/icons/`. Crear PNG cuadrados de 192×192 y 512×512; verificar dimensiones, formato, peso, alpha y apariencia sobre fondos claros/oscuros y recortes redondo/cuadrado. El dibujo mostrado ocupa casi todo el lienzo circular; usar propósito `any` inicialmente. Declarar `maskable` solo si la revisión visual confirma que la composición completa está dentro de la zona segura para máscara. No convertir una transparencia de origen en negro ni añadir un fondo de marca sin aprobación PO. La inspección por herramientas de imagen debe confirmar dimensiones/canal alpha del archivo original, que no se pudieron medir aquí; no inferirlas del preview del chat.

## Configuración del manifest y alojamiento

- Usar `name` y `short_name` = `NutrIA`, `display: standalone`, `start_url: /` y `scope: /`, sujeto a confirmar el dominio raíz de despliegue.
- Declarar recursos cuadrados con `sizes`, `type: image/png` y `purpose: any`; añadir una declaración separada para `maskable` solo si hay variante segura validada.
- Definir colores de tema/fondo que correspondan a Terra y al isotipo, tras confirmar visualmente la elección.
- Vercel configura `framework: vite` y publica `dist`; el fallback de SPA está después de la regla API. Confirmar que los recursos estáticos del build se resuelven antes del fallback y tienen content type apropiado. No ajustar `vercel.json` preventivamente.
- La configuración presupone que NutrIA se publica en la raíz del host, consistente con las URLs actuales del frontend/API. Si el preview/prod usa un prefijo, detenerse y ajustar juntos `base`, `start_url`, `scope` y URLs de recursos antes de cerrar.
- El uso en `localhost` sirve como contexto seguro de desarrollo, pero no acredita el requisito HTTPS de preview/prod. iOS usa “Añadir a pantalla de inicio” en Safari; no prometer prompt automático ni capacidades offline.

## Comandos y comprobaciones para implementación/QA

Desde `apps/web`:

1. Antes de editar HTML/client-side, ejecutar la búsqueda y recuperación de Google Modern Web Guidance pedidas por `.codex/skills/google-modern-web-guidance/SKILL.md`; adjuntar los guide IDs obtenidos. Esta etapa de exploración no ejecutó el comando.
2. `pnpm lint`
3. `pnpm test` (o pruebas focalizadas nuevas de manifest/asset si el tester las crea)
4. `pnpm build`
5. Inspeccionar `dist/manifest.webmanifest` y `dist/icons/*`; validar JSON, campos, relación entre inicio y ámbito, estado HTTP/Content-Type, PNG legible y dimensiones reales iguales a las declaradas.
6. Probar con `pnpm dev --host 127.0.0.1` que navegador obtiene manifest/iconos y verificar una ruta interna directa. El servidor local no acredita TLS.
7. Publicar/usar una URL HTTPS de preview con aprobación del responsable; validar manifest en Chromium desktop y navegador móvil Android representativo. Registrar dispositivo/versión, instalación, nombre, icono, modo standalone y navegación a ruta interna. Probar Safari/iOS real si el dispositivo está disponible; documentar si no.
8. Inspeccionar los iconos con máscara redonda/cuadrada y no declarar `maskable` sin evidencia de zona segura.

Ningún comando de prueba/build se ejecutó en esta exploración (solo lectura).

## Instrucciones y recursos faltantes

- Leídos `AGENTS.md`, `.ai/index.md`, arquitectura, calidad, frontend y release, más las skills instaladas `nutria-project-context` y `google-modern-web-guidance`.
- Las rutas `bundles/agent-libraries.json` y `bundles/development/AGENTS.md` exigidas por la instrucción raíz no existen en este checkout. No se encontró una biblioteca de MCP correspondiente al rol; no se usó MCP.
- El archivo central `management/links.md` fue consultado. No se necesita un enlace nuevo de producto para este alcance.

