# NUT-101 · Plan de implementación

Generado: 2026-10-28 · Base: `main` @ 6bdf082

## Archivos

| Archivo | Cambio | Dueño |
|---|---|---|
| `apps/web/src/app/App.tsx` | `App` pasa a tener `<Routes>`: `/` → `LandingPage`; `*` → `AccessGateBoundary` + `AuthenticatedApp`. Se elimina el `Navigate` de `/` a `/goals` dentro de `ProtectedApp`. | NUT-101. NUT-97 modifica después sólo el destino por defecto del login (`LoginRoute`) sobre este archivo ya mergeado. Orden de merge: NUT-101 → NUT-97. |
| `apps/web/src/modules/landing/pages/LandingPage.tsx` | Nuevo. Página estática, mobile first con breakpoints `md`/`lg`, con su propio `header` sticky. | NUT-101 |
| `apps/web/src/modules/landing/components/WeekPreview.tsx` | Nuevo. Ilustración decorativa de "Tu semana" (plan semanal + teléfono) con contenido de ejemplo fijo, sin imágenes ni datos de usuario. | NUT-101 |
| `apps/web/src/index.css` | Regla `html:has(.landing-page)` con `scroll-padding-top`, activa sólo mientras la landing está montada. | NUT-101 (la regla) |
| `apps/web/src/common/components/BrandMark.tsx` | Variante nueva `header` (mismos assets que `auth`, compacta, sin `mb-6`). Cambio sólo aditivo: `auth` y `app` no cambian. | Componente común; la variante `header` es de NUT-101. |
| `apps/web/src/common/components/tests/BrandMark.test.tsx` | Test de la variante `header`. | NUT-101 |
| `apps/web/src/modules/landing/pages/tests/LandingPage.test.tsx` | Nuevo. Semántica, enlaces, aria, carga diferida de la imagen del cierre y la sección "Tu semana" (posición, `aria-hidden`, sin interactivos ni cifras). | NUT-101 |
| `apps/web/src/app/tests/App.test.tsx` | Nuevo `describe('App public landing')`: `/` sin sesión y con sesión, gate, CTAs. | NUT-101 |

## Reutilizado sin modificar

- `BrandMark` (`src/common/components/BrandMark.tsx`): la misma marca que muestran el gate de acceso, el login y el registro.
- `PRIMARY_CTA_CLASSES` y `FOCUS_VISIBLE_CLASSES` (`src/modules/dashboard/components/classNames.ts`, dueño NUT-95): se importan desde ahí, sin moverlos.
- El acceso a login se muestra como enlace de texto ("¿Ya tenés cuenta? Iniciá sesión"), no como botón.
- Isotipo: `src/assets/nutria-isotype.png`.
- Tokens: `src/index.css`.

## Contratos

No se agregan tipos, props ni estados compartidos. `LandingPage` no recibe props.

## Verificación

- `pnpm vitest run src/app/tests/App.test.tsx src/modules/landing`
- `pnpm lint` (tsc) y `pnpm build`
- Revisión en Chromium a 360, 390, 767, 768 y 1280px: sin scroll horizontal; el "Crear cuenta" del encabezado tiene `display: none` y queda fuera del orden de Tab por debajo de 768px.
