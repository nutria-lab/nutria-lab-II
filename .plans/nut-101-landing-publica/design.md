# NUT-101 · Landing pública responsive — Diseño (etapa 1: móvil)

## Decisión

La ruta `/` muestra una landing estática y pública. Se resuelve en el router antes de que se monten el gate de acceso y la sesión, así que no depende de ellos ni hace llamadas de red. Todas las demás rutas siguen pasando por el gate de acceso y, si son privadas, por la sesión.

## Alcance de la etapa 1

- Composición móvil (mobile first, sin breakpoints `md`/`lg`). Desktop y tablet se definen en la etapa 2.
- Fuera de alcance de esta etapa: la sección "Tu semana" y cualquier mockup de producto, que esperan aprobación del PO.

## Arquitectura y flujo

- El router de nivel superior tiene dos ramas: `/` → landing; cualquier otra ruta → gate de acceso → proveedor de sesión → rutas de login, registro y privadas.
- La landing no lee la sesión: se ve igual con o sin sesión iniciada.
- La landing no consume `/meal-plans`, `/adherence`, `/shopping-list`, `/auth/me` ni `/access/status`. Una caída del backend no la afecta.
- La ruta privada `/` que redirigía a `/goals` deja de existir: `/` es siempre la landing. El destino por defecto después del login se mantiene; su cambio a `/dashboard` pertenece a NUT-97.
- Recarga en `/`: la cubre el fallback SPA existente (rewrite de todo a `index.html`).

## Composición (móvil)

1. **Encabezado** (`header` sticky): la misma marca oficial que la pantalla del gate de acceso (logotipo "nutria" + isotipo), en tamaño compacto, y el enlace "Iniciar sesión" → `/login`.
2. **Hero** (centrado): isotipo chico decorativo (asset local, dentro de un círculo), título `h1`, subtítulo, botón "Crear cuenta" → `/register` a ancho completo, y el texto "¿Ya tenés cuenta?" con el enlace "Iniciá sesión" → `/login`.
3. **Cómo funciona**: antetítulo "Paso a paso", `h2` y una lista ordenada de 3 pasos en tarjetas (`h3` + descripción). El numeral visual 01/02/03 es decorativo (`aria-hidden`); el orden lo da la lista.
4. **Cierre** (`h2`): isotipo decorativo, "Crear cuenta" → `/register` a ancho completo y "¿Ya tenés cuenta? Iniciá sesión" → `/login`, igual que en el hero.
5. **Footer**: "© {año} NutrIA".

Sin sidebar, bottom navigation, carrusel, formularios, imágenes remotas ni animaciones.

## Estados

La página no tiene estados de datos: no recibe props, no hace fetch y no tiene loading, empty ni error. El único estado posible es "contenido estático". Tampoco hay enums, fixtures ni manejo de 401.

## Accesibilidad

- Un solo `h1`; `h2` por sección y `h3` por paso.
- Foco visible en todos los enlaces (anillo verde Terra).
- Áreas táctiles de al menos 44px de alto.
- Contraste: texto verde Terra sobre crema (4,52:1), antetítulo en verde oscuro (≥ 7:1), blanco sobre verde (4,86:1), gris de cuerpo sobre blanco o crema (≥ 7,5:1). Los numerales son decorativos.
- Sin overflow horizontal a 360px y 390px.

## Textos (pendientes de validación del PO)

| Lugar | Texto |
|---|---|
| Título | Planifica tus comidas, recetas y compras en un solo lugar |
| Subtítulo | NutrIA te ayuda a armar tu plan semanal según tus preferencias y a organizar tu lista de compras. |
| Paso 1 | Completá tus preferencias — Contanos tus gustos, objetivos y restricciones. |
| Paso 2 | Armá tu plan — Obtené un plan semanal de comidas y recetas. |
| Paso 3 | Organizá y registrá — Prepará tu lista de compras y registrá lo que comés. |
| Antetítulo | Paso a paso |
| Cierre | Empezá a organizar tu semana |
| CTAs | Crear cuenta · Iniciar sesión · ¿Ya tenés cuenta? Iniciá sesión |

Los textos usan voseo, igual que login y registro ("Iniciá sesión", "Registrate"). "Crear cuenta" coincide con el botón de registro existente.

## Criterios de aceptación y pruebas requeridas

1. `/` sin sesión muestra la landing y no redirige.
2. Abrir `/` no hace ninguna petición HTTP, ni siquiera la del gate ni la de sesión; con un backend que falla, la landing igual se muestra.
3. "Crear cuenta" lleva a `/register`; "Iniciar sesión" e "Iniciá sesión" llevan a `/login`.
4. En la landing no hay landmarks de navegación de la app (ni sidebar ni bottom nav).
5. `/dashboard` sin sesión sigue redirigiendo a `/login`, y las rutas no públicas siguen exigiendo el gate de acceso cuando es requerido.
6. Hay un solo `h1`, los numerales son `aria-hidden` y los 3 pasos están en una lista ordenada.

## Base de datos y migraciones

No aplica: no cambia el backend, el esquema ni las variables de seguridad.
