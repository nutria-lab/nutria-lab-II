# NUT-101 · Landing pública responsive — Diseño

## Decisión

La ruta `/` muestra una landing estática y pública. Se resuelve en el router antes de que se monten el gate de acceso y la sesión, así que no depende de ellos ni hace llamadas de red. Todas las demás rutas siguen pasando por el gate de acceso y, si son privadas, por la sesión.

## Alcance

- Mobile first. Tablet desde `md` (768px) y desktop desde `lg` (1024px), con contenido limitado a 72rem y centrado.
- La sección "Tu semana" (vista previa del plan y de la app en un teléfono) es una ilustración con contenido de ejemplo y queda sujeta a la aprobación del PO.

## Arquitectura y flujo

- El router de nivel superior tiene dos ramas: `/` → landing; cualquier otra ruta → gate de acceso → proveedor de sesión → rutas de login, registro y privadas.
- La landing no lee la sesión: se ve igual con o sin sesión iniciada.
- La landing no consume `/meal-plans`, `/adherence`, `/shopping-list`, `/auth/me` ni `/access/status`. Una caída del backend no la afecta.
- La ruta privada `/` que redirigía a `/goals` deja de existir: `/` es siempre la landing. El destino por defecto después del login se mantiene; su cambio a `/dashboard` pertenece a NUT-97.
- Recarga en `/`: la cubre el fallback SPA existente (rewrite de todo a `index.html`).

## Composición (móvil)

1. **Encabezado** (`header` sticky): la misma marca oficial que la pantalla del gate de acceso (logotipo "nutria" + isotipo), en tamaño compacto, y el enlace "Iniciar sesión" → `/login`.
2. **Hero** (centrado): isotipo chico decorativo (asset local; el PNG ya incluye su propio círculo), título `h1`, subtítulo, botón "Crear cuenta" → `/register` a ancho completo, y el texto "¿Ya tenés cuenta?" con el enlace "Iniciá sesión" → `/login`.
3. **Cómo funciona**: antetítulo "Paso a paso", `h2` y una lista ordenada de 3 pasos en tarjetas (`h3` + descripción). El numeral visual 01/02/03 es decorativo (`aria-hidden`); el orden lo da la lista.
4. **Tu semana**: antetítulo "Vista previa", `h2` "Tu semana, más fácil de visualizar" y subtítulo. Debajo, una ilustración hecha con estilos Terra (sin imágenes):
   - **Plan semanal**: días Lun–Dom con el lunes seleccionado y tres comidas de ejemplo (Desayuno, Almuerzo, Cena) con un ícono por tipo de comida, nombre y tiempo de preparación.
   - **Teléfono**: la pantalla de inicio de la app con el saludo genérico "Hola", "Progreso semanal" con barra y días sin porcentaje, "Siguiente comida por registrar" con nombre y tiempo, y el acceso "Ver mi plan semanal".
   - Toda la ilustración es `aria-hidden` y no tiene elementos interactivos: los días, flechas y accesos son decorativos. Un texto `sr-only` la describe. No muestra porcentajes, calorías ni nombres de personas.
5. **Cierre** (`h2`): isotipo decorativo con carga diferida (`loading="lazy"`, `decoding="async"`; el del hero carga normal porque está en la primera pantalla), "Crear cuenta" → `/register` a ancho completo y "¿Ya tenés cuenta? Iniciá sesión" → `/login`, igual que en el hero.
6. **Footer**: "© {año} NutrIA".

## Composición (tablet y desktop, `md`+)

- **Encabezado**: además de "Iniciar sesión", muestra el botón "Crear cuenta" → `/register`. En móvil ese botón no se muestra.
- **Hero**: dos columnas. A la izquierda, alineados a la izquierda, el título, el subtítulo y las acciones. A la derecha, el isotipo grande (256px en `md`, 320px en `lg`) sobre un círculo crema.
- **Acciones** (hero y cierre): "Crear cuenta" con ancho propio y "¿Ya tenés cuenta? Iniciá sesión" al lado, en la misma fila. En el hero se alinean a la izquierda y en el cierre se centran.
- **Cómo funciona**: las 3 tarjetas en 3 columnas.
- **Tu semana**: el plan semanal a la izquierda y el teléfono a la derecha. En móvil, el teléfono va debajo del plan y las flechas de los días no se muestran.

Sin sidebar, bottom navigation, carrusel, formularios, fotos, imágenes remotas ni animaciones.

## Estados

La página no tiene estados de datos: no recibe props, no hace fetch y no tiene loading, empty ni error. El único estado posible es "contenido estático". Tampoco hay enums, fixtures ni manejo de 401.

## Accesibilidad

- Un solo `h1`; `h2` por sección y `h3` por paso.
- Foco visible en todos los enlaces (anillo verde Terra).
- Áreas táctiles de al menos 44px de alto.
- El encabezado tiene alto mínimo, no fijo, y sus enlaces no se parten en dos líneas, para soportar el zoom de texto.
- El foco nunca queda tapado por el encabezado sticky (`scroll-padding-top` de 5rem mientras la landing está montada).
- Si la fuente de íconos no carga, el texto del ícono queda recortado dentro de su círculo.
- Contraste: texto verde Terra sobre crema (4,52:1), antetítulo en verde oscuro (≥ 7:1), blanco sobre verde (4,86:1), gris de cuerpo sobre blanco o crema (≥ 7,5:1). Los numerales son decorativos.
- Sin overflow horizontal a 360px, 390px, 768px y 1280px.

## Textos (pendientes de validación del PO)

| Lugar | Texto |
|---|---|
| Título | Planificá tus comidas, recetas y compras en un solo lugar |
| Subtítulo | NutrIA te ayuda a armar tu plan semanal según tus preferencias y a organizar tu lista de compras. |
| Paso 1 | Completá tus preferencias — Contanos tus gustos, objetivos y restricciones. |
| Paso 2 | Armá tu plan — Obtené un plan semanal de comidas y recetas. |
| Paso 3 | Organizá y registrá — Prepará tu lista de compras y registrá lo que comés. |
| Antetítulo | Paso a paso |
| Tu semana | Vista previa · Tu semana, más fácil de visualizar · Plan de comidas y lista de compras en un solo lugar. |
| Tu semana (ejemplo) | Avena con frutas y semillas (10 min) · Bowl de quinoa con pollo y verduras (25 min) · Pasta integral con brócoli y champiñones (20 min) |
| Tu semana (teléfono) | Reutiliza textos del dashboard: Hola · Hoy es un buen día para nutrirte. · Progreso semanal · Siguiente comida por registrar · Ver mi plan semanal · Revisá las comidas de la semana |
| Cierre | Empezá a organizar tu semana |
| CTAs | Crear cuenta · Iniciar sesión · ¿Ya tenés cuenta? Iniciá sesión |

Los textos usan voseo, igual que login y registro ("Iniciá sesión", "Registrate"). "Crear cuenta" coincide con el botón de registro existente.

## Criterios de aceptación y pruebas requeridas

1. `/` sin sesión muestra la landing y no redirige.
2. Abrir `/` no hace ninguna petición HTTP, ni siquiera la del gate ni la de sesión; con un backend que falla, la landing igual se muestra.
3. Todos los "Crear cuenta" (hero, cierre y el del encabezado de tablet/desktop) llevan a `/register`; "Iniciar sesión" e "Iniciá sesión" llevan a `/login`.
4. En la landing no hay landmarks de navegación de la app (ni sidebar ni bottom nav).
5. `/dashboard` sin sesión sigue redirigiendo a `/login`, y las rutas no públicas siguen exigiendo el gate de acceso cuando es requerido.
6. Hay un solo `h1`, los numerales son `aria-hidden` y los 3 pasos están en una lista ordenada.
7. "Tu semana" va entre "Cómo funciona" y el cierre; su ilustración es `aria-hidden`, está descrita con texto `sr-only`, no tiene elementos interactivos ni encabezados y no muestra porcentajes, calorías ni nombres de personas.

## Base de datos y migraciones

No aplica: no cambia el backend, el esquema ni las variables de seguridad.
