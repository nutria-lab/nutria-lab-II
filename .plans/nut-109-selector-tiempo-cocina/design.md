# NUT-109 — Selector móvil de tiempo de cocina por posiciones (diseño frontend)

Etapa: diseño. Generado: 2026-11-02. Alcance: solo frontend, sin cambios de enum ni backend. Fuente visual: Stitch proyecto `5785725448623770239`, frame "Configuración de Perfil - Móvil" (`d0afa4fb…`), solo lectura.

## 1. Decisiones

| # | Decisión | Motivo |
|---|---|---|
| D1 | Un único arreglo ordenado de opciones `QUICK=15`, `STANDARD=30`, `GOURMET=60` alimenta el slider móvil, sus marcas y las tarjetas de desktop. | Equivalencia móvil/desktop; sin mapas paralelos. |
| D2 | El slider opera sobre posiciones: `min=0`, `max=2`, `step=1`. La posición es el índice del arreglo. Nunca se redondea desde minutos. | Las posiciones nativas coinciden con las opciones: no existe 45. Flechas, Home/End y gesto táctil funcionan sin manejar teclas a mano. |
| D3 | `aria-label` fijo "Tiempo de cocina"; `aria-valuetext` "{Título}, {minutos} minutos". | El lector de pantalla anuncia la opción, no 0, 1 o 2. |
| D4 | Tres marcas visuales en tres columnas iguales, alineadas a izquierda, centro y derecha, en el formato "{Título} ({valor})". La marca elegida se resalta con color y peso. | Coinciden con las tres posiciones del slider, también en 320 px. |
| D5 | Un valor fuera del enum no se presenta como una opción: se muestra "Sin elegir", ninguna marca ni tarjeta resaltada, slider en la posición central y `aria-valuetext` "Sin elegir". El paso de la página queda "Pendiente", no suma al progreso y no se puede guardar hasta elegir. Mover el slider o elegir una tarjeta selecciona una opción válida; como el slider ya está al centro, en móvil "Estándar" se alcanza pasando por un extremo. | Regla de enums: un valor desconocido nunca afirma algo falso. La base lo guarda como enum obligatorio, así que solo aparecería si frontend y backend se desalinean. |
| D6 | `disabled` desactiva slider y tarjetas mientras se guarda; un fallo de guardado conserva la selección del formulario para reintentar. | Criterio de aceptación del ticket. |

ADR: no requerido.

## 2. Estados

| Valor / estado | Texto visible | Posición | `aria-valuetext` | Marca / tarjeta resaltada |
|---|---|---|---|---|
| `QUICK` | 15 min | 0 | Rápido, 15 minutos | Rápido |
| `STANDARD` | 30 min | 1 | Estándar, 30 minutos | Estándar |
| `GOURMET` | 60 min | 2 | Gourmet, 60 minutos | Gourmet |
| desconocido | Sin elegir | 1 | Sin elegir | ninguna; paso "Pendiente" y guardado deshabilitado |

| Guardado | Slider y tarjetas | Selección |
|---|---|---|
| en curso | deshabilitados | se mantiene |
| correcto | habilitados | la guardada; se conserva al recargar |
| fallido | habilitados, aviso de error | se mantiene y "Guardar preferencias" reintenta el mismo enum |

## 3. Textos

Reutilizados: títulos de desktop "Rápido", "Estándar", "Gourmet", "15m", "30m", "60m".
Nuevos, pendientes de validación PO: "Sin elegir".

## 4. Diferencias con Stitch (validar con PO)

- El frame tiene dos marcas y llega a 90 min ("Elaborado (90m)"): el producto tiene tres opciones hasta 60, sin 45 ni 90.
- "Elaborado" pasa a "Gourmet" para coincidir con desktop y con el enum.
- La marca central "Estándar (30m)" y el resaltado de la marca elegida no están en el frame.

## 5. Historia, criterios y pruebas requeridas

Como persona que usa la app en móvil, con teclado o toque, quiero elegir cualquiera de los tres tiempos de cocina y que quede guardado.

Los criterios de aceptación son los de NUT-109. Pruebas requeridas: regresión 30 + flecha derecha; recorrido 15→30→60 y vuelta; Home/End y extremos; evento `change` a cada posición; `aria-valuetext` en cada posición; tarjetas de desktop; guardar y recargar cada enum; `disabled` durante el guardado; selección conservada y reintento tras un fallo; valor fuera del enum.

## 6. Pendientes escalados (fuera del alcance de NUT-109)

| # | Pendiente | Efecto actual |
|---|---|---|
| P1 | El aviso de error de guardado está arriba de la página y el botón abajo, sin foco ni scroll. | En móvil, un guardado fallido puede parecer que no hizo nada. |
| P2 | El input mide 8 px de alto y el control unos 16 px. | Área táctil chica, por debajo de los 44 px usados en otros controles. |
| P3 | "Tus preferencias se guardaron correctamente" sigue visible después de seguir editando. | El aviso puede quedar desactualizado. |
| P4 | "Volver al perfil" no tiene acción. | El botón no hace nada. |
| P5 | Generar recetas nombra GOURMET "Sin apuro"; preferencias dice "Gourmet". | Vocabulario distinto para la misma opción. |
| P6 | No hay E2E con teclado real en `apps/web`. | Un `preventDefault` futuro sobre las teclas no haría fallar las pruebas. |

## 7. Base de datos

Ninguna.
