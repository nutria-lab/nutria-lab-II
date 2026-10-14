# NUT-85 T1 — Evidencia A4 (`prisma migrate deploy` sobre Postgres desechable)

Fecha: 2026-10-09. Ejecutado por el implementer backend. Sin secretos: credenciales de un contenedor local desechable (`kpitest`), nunca `.env`.

## Entorno

- Contenedor: `nutria-kpi-test-pg` (`postgres:16-alpine`, PostgreSQL 16.15), puerto `localhost:55432`.
- Prisma CLI 7.9.1, desde `apps/api`.
- Migración nueva: `apps/api/prisma/migrations/20261009213000_add_kpi_telemetry/migration.sql`.

## Guarda de destino

Todo comando de Prisma se corrió con un wrapper que (1) arma la URL local, (2) imprime host y base (sin la contraseña), (3) aborta si el host no es `localhost`/`127.0.0.1`, y (4) setea **ambas** variables en el mismo comando:

```bash
URL="postgresql://kpitest:***@localhost:55432/$DB"
echo ">> destino: host=$HOST db=$DB"     # localhost:55432
case "$HOST" in localhost:*|127.0.0.1:*) ;; *) exit 99;; esac
DATABASE_URL="$URL" DATABASE_URL_UNPOOLED="$URL" pnpm exec prisma <args>
```

Prisma también confirmó el destino en cada corrida: `Datasource "db": PostgreSQL database "<db>", schema "public" at "localhost:55432"`.

## Bases desechables

```bash
docker exec nutria-kpi-test-pg psql -U kpitest -d kpitest -c "CREATE DATABASE kpi_empty"
docker exec nutria-kpi-test-pg psql -U kpitest -d kpitest -c "CREATE DATABASE kpi_withdata"
docker exec nutria-kpi-test-pg psql -U kpitest -d kpitest -c "CREATE DATABASE kpi_scratch"   # sólo para generar el diff base; borrada al final
```

## 1. kpi_withdata: migraciones previas, datos, migración NUT-85

Paso 1. Antes de crear la carpeta `*_add_kpi_telemetry` se aplicaron las 11 migraciones existentes:

```
>> destino: host=localhost:55432 db=kpi_withdata
Datasource "db": PostgreSQL database "kpi_withdata", schema "public" at "localhost:55432"
11 migrations found in prisma/migrations
Applying migration `20260822202113_first_migration`
... (9 más)
Applying migration `20260930220304_add_recipe_image`
All migrations have been successfully applied.
```

Paso 2. Datos sintéticos (sin seed, sin PII real; dominio `example.test`): 3 users, 2 recipes, 2 meal_plans.

Paso 3. Conteo y huella antes y después, con md5 de `to_jsonb(fila)` ordenado por id, es decir de todas las columnas:

```sql
SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM recipes) AS recipes, (SELECT count(*) FROM meal_plans) AS meal_plans,
  md5((SELECT string_agg(to_jsonb(u)::text, ',' ORDER BY id) FROM users u)) AS users_md5,
  md5((SELECT string_agg(to_jsonb(r)::text, ',' ORDER BY id) FROM recipes r)) AS recipes_md5,
  md5((SELECT string_agg(to_jsonb(p)::text, ',' ORDER BY id) FROM meal_plans p)) AS meal_plans_md5;
```

| Momento | users | recipes | meal_plans | users_md5 | recipes_md5 | meal_plans_md5 |
|---|---|---|---|---|---|---|
| Antes | 3 | 2 | 2 | 9f913f1ec47948665157fd924e0ac50b | 2e09090d2885117db0b62517df0ec735 | 68d139a7dff5e867d20b1ef162d48d4e |
| Después | 3 | 2 | 2 | 9f913f1ec47948665157fd924e0ac50b | 2e09090d2885117db0b62517df0ec735 | 68d139a7dff5e867d20b1ef162d48d4e |

Salida del deploy (sólo se aplicó NUT-85):

```
>> destino: host=localhost:55432 db=kpi_withdata
Datasource "db": PostgreSQL database "kpi_withdata", schema "public" at "localhost:55432"
12 migrations found in prisma/migrations
Following migration have not yet been applied:
20261009213000_add_kpi_telemetry
Applying migration `20261009213000_add_kpi_telemetry`
All migrations have been successfully applied.
```

## 2. kpi_empty: todas las migraciones

```
>> destino: host=localhost:55432 db=kpi_empty
Datasource "db": PostgreSQL database "kpi_empty", schema "public" at "localhost:55432"
12 migrations found in prisma/migrations
Applying migration `20260822202113_first_migration`
... (10 más)
Applying migration `20261009213000_add_kpi_telemetry`
All migrations have been successfully applied.
```

## 3. Estructura resultante (idéntica en kpi_empty y kpi_withdata)

- Tablas: `kpi_dependency_event, kpi_health_sample, kpi_http_event, kpi_publication, kpi_snapshot`.
- `pg_constraint` sobre tablas `kpi_*`: 41 CHECK (8 http, 7 dependency, 7 health, 10 snapshot, 9 publication) + 5 PK. 0 FK.
- Índices: 5 `*_pkey`, 4 UNIQUE (`kpi_dependency_event_attempt_key`, `kpi_health_sample_bucket_key`, `kpi_snapshot_cut_key`, `kpi_publication_day_key`), 8 índices `kpi_*_idx`, más `meal_plans_createdAt_idx` y `recipes_createdAt_idx`. El filtro `%createdAt_idx` también lista `generation_runs_userId_createdAt_idx`, que ya existía antes de NUT-85.

## 4. Drift Prisma ↔ base

```bash
DATABASE_URL=<local> DATABASE_URL_UNPOOLED=<local> pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma --exit-code
```

| Base | Resultado | Exit |
|---|---|---|
| kpi_empty | `No difference detected.` | 0 |
| kpi_withdata | `No difference detected.` | 0 |

Prisma no ve los CHECK. Índices, UNIQUE, tipos y defaults coinciden por nombre.

Generación: el SQL base (tablas, PK, índices) salió de `prisma migrate diff --from-config-datasource --to-schema prisma --script` contra `kpi_scratch`, con las 11 migraciones previas aplicadas. El diff sólo contenía `CREATE TABLE`/`CREATE INDEX`, es decir que no había otro drift. Los CHECK nombrados se agregaron a mano dentro de cada `CREATE TABLE`, y los defaults de timestamp usan `CURRENT_TIMESTAMP`, como los genera Prisma.

## 5. Revisión del SQL (A3)

- El SQL sólo tiene `CREATE TABLE` (5 tablas `kpi_*`), `CREATE UNIQUE INDEX` (4) y `CREATE INDEX` (8 KPI + 2 de negocio sobre `"createdAt"`).
- No tiene `DROP`, `TRUNCATE`, `DELETE`, `UPDATE`, `INSERT`, `RENAME`, `ALTER` (ninguno), `EXTENSION`, `TRIGGER`, `FUNCTION`, FK/`REFERENCES` ni `CONCURRENTLY`. Tampoco califica schema (`public.`).
- Riesgo aceptado (design §5.2): `CREATE INDEX` sin `CONCURRENTLY` bloquea escrituras en `meal_plans`/`recipes` mientras se crea el índice. Con el volumen actual son milisegundos.
- Rollback operativo: es aditiva y no tiene "down". Ver design §5.5.

## Limpieza

- `kpi_scratch` se borró. `kpi_empty` y `kpi_withdata` quedan en el contenedor local desechable para inspección y se pueden borrar sin impacto.
- No se tocó `apps/api/.env` ni ninguna base compartida o Neon.
