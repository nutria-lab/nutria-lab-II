# Evidencia de instalacion basica PWA

## Implementado

- `apps/web/public/manifest.webmanifest`: nombre NutrIA, `start_url` y `scope` en `/`, modo `standalone` y colores Terra.
- `apps/web/public/icons/nutria-192.png` y `nutria-512.png`: iconos derivados del isotipo de 2048 x 2048 px proporcionado por el usuario, conservando transparencia y sin declarar `maskable`.
- `apps/web/public/icons/nutria-180.png`: icono para pantalla de inicio de Apple.
- `apps/web/index.html`: enlaces al manifest, color de tema y metadatos de Apple.
- Sin service worker, politica offline, cambios de ruta, dependencia PWA o cambios a Vercel.

## Verificado

- `node node_modules/vitest/vitest.mjs run src/pwa/pwaInstallability.test.ts` — 4/4 pruebas aprobadas.
- `node node_modules/typescript/bin/tsc --noEmit` — salida 0.
- `node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' run build` desde `apps/web` — salida 0.
- El build publica `manifest.webmanifest` y los PNG de 180, 192 y 512 px bajo `dist/`.
- Cuatro revisiones de codigo (riesgo, legibilidad, confiabilidad y resiliencia) — sin hallazgos accionables.

## Pendiente de evidencia externa

- No se instalo desde una URL HTTPS de preview o produccion en desktop ni en telefono. El checkout no incluye una URL de frontend publicada ni una sesion de dispositivo movil para validar ese flujo.
- El build local y las pruebas de archivos no demuestran que el navegador ofrezca instalar, que iOS aplique el icono esperado ni que la app se abra en modo independiente en cada plataforma.
- No se ofrece soporte offline. Para agregarlo hay que definir y revisar por separado la politica de cache y datos autenticados.

