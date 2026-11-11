# ADR-0003: Clasificación AI efímera de mealType para Recipes existentes

**Estado:** Aprobado por el equipo para NUT-76 (2026-10-26).

## Contexto

La composición semanal necesita compatibilidad Recipe ↔ mealType para reutilizar el catálogo sin modificar la identidad de una Recipe. Recipe no tiene una clasificación contractual por mealType. La decisión aprobada permite que AI clasifique Recipes existentes a partir de su título e ingredientes.

## Decisión

- Un clasificador AI interno recibe páginas ordenadas de `{title, ingredients}` y devuelve, por posición, cero o más valores del enum `BREAKFAST`, `LUNCH`, `SNACK` y `DINNER`.
- La clasificación se calcula una vez por página y se mantiene sólo durante la composición. No se envían IDs, perfil, datos personales ni metadata interna; los IDs se correlacionan localmente por posición.
- Las páginas usan cursor keyset determinista. Después de cada página, el matching máximo existente se recalcula; la lectura del catálogo termina cuando alcanza 28/28 slots o se agota el catálogo.
- AI clasifica el catálogo; `RecipeGenerationProvider` genera Recipes nuevas sólo para los slots faltantes. Ambas operaciones mantienen auditoría interna separada.
- Antes de clasificar, la composición aplica localmente el diccionario de restricciones de perfil existente. Si ese diccionario no tiene una política soportada para el perfil (actualmente KETO/PALEO), no reutiliza catálogo y continúa por la generación AI existente. Esto no agrega una regla estricta de macros ni decide esa política pendiente.
- La clasificación malformada o la indisponibilidad del provider falla de forma recuperable; no se convierte en incompatibilidad. No se guarda `mealType` en Recipe y no se aplican heurísticas locales sobre título, categorías o properties.
- La persistencia del plan mantiene su transacción vigente. No se requiere cambio de Prisma, API pública ni migración.

## Alternativas descartadas

- Inferir mealType con reglas manuales desde título, categorías o properties: descartado por la decisión aprobada.
- Clasificar cada receta una vez por slot: descartado por costo y latencia; se clasifica por páginas.
- Cargar todo el catálogo antes de empezar a clasificar: descartado porque impide el corte temprano cuando 28 slots ya tienen matching.
- Persistir mealType en Recipe: fuera de alcance y no necesario para esta clasificación efímera.

## Consecuencias y reversión

La reutilización del catálogo depende de una llamada AI adicional y de una respuesta estructurada válida. La paginación limita el lote y el costo observado por composición; el corte temprano evita recorrer páginas innecesarias. Errores del provider o salida inválida dejan el intento en fallo recuperable y no producen un plan parcial.

El rollback consiste en revertir el binding del clasificador y volver a la composición anterior; como la clasificación no se persiste y no cambia el schema, no requiere backfill ni migración de reversión.

## Decisiones todavía abiertas

Este ADR no decide la política estricta KETO/PALEO, la repetición de Recipe frente a generación AI ni el endurecimiento futuro de `weekStart`.
