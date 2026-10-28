# NUT-101 · Plan de implementación (etapa 1: móvil)

Generado: 2026-10-28 · Base: `main` @ 6bdf082

## Archivos

| Archivo | Cambio | Dueño |
|---|---|---|
| `apps/web/src/app/App.tsx` | `App` pasa a tener `<Routes>`: `/` → `LandingPage`; `*` → `AccessGateBoundary` + `AuthenticatedApp`. Se elimina el `Navigate` de `/` a `/goals` dentro de `ProtectedApp`. | NUT-101. NUT-97 modifica después sólo el destino por defecto del login (`LoginRoute`) sobre este archivo ya mergeado. Orden de merge: NUT-101 → NUT-97. |
| `apps/web/src/modules/landing/pages/LandingPage.tsx` | Nuevo. Página estática con su propio `header` sticky. | NUT-101 |
| `apps/web/src/common/components/BrandMark.tsx` | Variante nueva `header` (mismos assets que `auth`, compacta, sin `mb-6`). Cambio sólo aditivo: `auth` y `app` no cambian. | Componente común; la variante `header` es de NUT-101. |
| `apps/web/src/common/components/tests/BrandMark.test.tsx` | Test de la variante `header`. | NUT-101 |
| `apps/web/src/modules/landing/pages/tests/LandingPage.test.tsx` | Nuevo. Semántica, enlaces y aria. | NUT-101 |
| `apps/web/src/app/tests/App.test.tsx` | Nuevo `describe('App public landing')`. | NUT-101 |

## Reutilizado sin modificar

- `BrandMark` (`src/common/components/BrandMark.tsx`): la misma marca que muestran el gate de acceso, el login y el registro.
- `PRIMARY_CTA_CLASSES` y `FOCUS_VISIBLE_CLASSES` (`src/modules/dashboard/components/classNames.ts`, dueño NUT-95): se importan desde ahí, sin moverlos.
- Estilo de botón secundario: el mismo patrón de `RegistrationPage.tsx` (botón "Iniciá sesión" con borde).
- Isotipo: `src/assets/nutria-isotype.png`.
- Tokens: `src/index.css`.

## Contratos

No se agregan tipos, props ni estados compartidos. `LandingPage` no recibe props.

## Verificación

- `pnpm vitest run src/app/tests/App.test.tsx src/modules/landing`
- `pnpm lint` (tsc) y `pnpm build`
- Revisión visual a 360px y 390px: sin scroll horizontal.
