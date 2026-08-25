## Re-review: changes requested

Todavía quedan inconsistencias de configuración que CI no detecta y que deben resolverse antes de aprobar.

### 1. Limpiar el cliente Prisma generado subido accidentalmente

Se agregó `apps/api/src/generated/` al `.gitignore`, pero este PR ya contiene archivos generados en `apps/api/generated/prisma/`. Esa ruta no coincide con el `output` configurado, que apunta a `src/generated/prisma`.

Ignorar una ruta evita commits futuros, pero no elimina archivos que ya están trackeados. Eliminar del PR todo `apps/api/generated/prisma/**` y verificar que el árbol quede limpio. El cliente debe generarse durante el build, no versionarse.

### 2. Restaurar TypeScript 7.0.2

El root package pasó de:

```json
"typescript": "^7.0.2"
```

a:

```json
"typescript": "^5.7.3"
```

No hay una justificación técnica en este PR para el downgrade. Además, se agregó otra declaración de TypeScript dentro de `apps/api`, creando dos fuentes de verdad para la misma herramienta.

Restaurar TypeScript `^7.0.2` en el root, evitar el override local salvo necesidad demostrada y regenerar `pnpm-lock.yaml`.

### 3. Recuperar el esquema Prisma multi-file

El proyecto debe mantener las entidades Prisma separadas por dominio. Hoy `User` quedó dentro de `prisma/schema.prisma` y `prisma.config.ts` apunta a un archivo:

```ts
schema: "prisma/schema.prisma"
```

En Prisma 7, para multi-file schemas, `schema` debe apuntar al directorio:

```ts
schema: "prisma/"
```

`schema.prisma` debe conservar únicamente `generator` y `datasource`, y el modelo debe vivir en:

```text
prisma/models/user.prisma
```

Esto no es cosmético. Si la config apunta al archivo, Prisma puede generar correctamente pero ignorar silenciosamente los modelos que se agreguen después en otros archivos. Referencia obligatoria: https://www.prisma.io/blog/organize-your-prisma-schema-with-multi-file-support

### 4. Alinear el generator con NestJS

Ya existe un `output`, pero el generator sigue usando `prisma-client-js`. Alinearlo con la receta vigente de NestJS:

```prisma
generator client {
  provider     = "prisma-client"
  output       = "../src/generated/prisma"
  moduleFormat = "cjs"
}
```

Referencia: https://docs.nestjs.com/recipes/prisma

### Para volver a revisar

1. No quedan artefactos `apps/api/generated/prisma/**` trackeados.
2. TypeScript vuelve a `^7.0.2` y el lockfile queda sincronizado.
3. `User` queda en `prisma/models/user.prisma`.
4. `prisma.config.ts` apunta a `prisma/`.
5. `schema.prisma` conserva solo generator y datasource.
6. El generator usa `prisma-client` y genera en `src/generated/prisma`.
7. CI vuelve a pasar desde una instalación limpia.
