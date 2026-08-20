# Inicialización del workspace

Este documento arranca el proyecto desde cero con Turborepo, separa frontend y backend, y deja lista la conexión con Neon + Prisma.

## 1) Requisitos previos

- Node.js 20+ o la versión LTS que use tu equipo.
- pnpm 9+.
- Cuenta en Neon con un proyecto y una base Postgres creada.
- Nest CLI disponible vía `npx` o instalado globalmente.

## 2) Crear el workspace

```bash
mkdir nutria-labII
cd nutria-labII
pnpm init -y
```

Instala las dependencias base del monorepo:

```bash
pnpm add -D turbo typescript @types/node
```

Crea la configuración de workspaces:

```yaml
# pnpm-workspace.yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

Agrega scripts de root en `package.json`:

```json
{
  "name": "nutria-labII",
  "private": true,
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "test": "turbo run test"
  }
}
```

## 3) Crear `apps/web` con React + Vite

```bash
pnpm create vite@latest apps/web -- --template react-ts
cd apps/web
pnpm install
cd ../..
```

Dependencias recomendadas para el frontend:

```bash
pnpm --filter web add axios js-cookie i18next react-i18next react-router-dom
pnpm --filter web add -D tailwindcss postcss autoprefixer
pnpm --filter web add framer-motion
```

Si vas a usar Tailwind, inicialízalo dentro de `apps/web`:

```bash
cd apps/web
npx tailwindcss init -p
cd ../..
```

## 4) Crear `apps/api` con NestJS

```bash
npx @nestjs/cli new apps/api --package-manager pnpm
```

Dependencias base del backend:

```bash
pnpm --filter api add @nestjs/config @nestjs/jwt @nestjs/passport passport passport-jwt bcrypt zod @google/generative-ai dotenv
pnpm --filter api add prisma @prisma/client
pnpm --filter api add -D @types/bcrypt @types/passport-jwt
```

> Nota: si tu equipo prefiere menos dependencias, `UUID` puede resolverse con `crypto.randomUUID()` sin agregar un paquete externo.

## 5) Crear `turbo.json`

Usa la sintaxis moderna de Turborepo con `tasks`:

```json
{
  "$schema": "https://turborepo.dev/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "build/**", "coverage/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^lint"]
    },
    "test": {
      "dependsOn": ["^build"]
    }
  }
}
```

## 6) Configuración de Prisma para Neon

En `apps/api`, inicializa Prisma:

```bash
cd apps/api
npx prisma init
cd ../..
```

En `apps/api/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

## 6.1) Prisma con múltiples archivos

Prisma soporta organizar el schema en múltiples archivos. Para este proyecto, la convención es:

- `prisma/schema.prisma` como archivo principal;
- `prisma/models/user.prisma`;
- `prisma/models/task.prisma`;
- `prisma/models/subtask.prisma`.

Regla importante:
- una tabla/modelo por archivo;
- no agrupar varios modelos en el mismo `.prisma`;
- `schema.prisma` debe quedarse como el punto de entrada del schema.

Ejemplo de estructura:

```text
apps/api/prisma/
├─ migrations/
├─ schema.prisma
└─ models/
   ├─ user.prisma
   ├─ task.prisma
   └─ subtask.prisma
```

### Variables de entorno

Crea `apps/api/.env` con algo como esto:

```dotenv
DATABASE_URL="postgresql://USER:PASSWORD@ep-xxxxx.us-east-1.aws.neon.tech/mini_jira?sslmode=require&pgbouncer=true&connect_timeout=15"
DIRECT_URL="postgresql://USER:PASSWORD@ep-xxxxx.us-east-1.aws.neon.tech/mini_jira?sslmode=require"
JWT_SECRET="replace-with-a-long-random-secret"
JWT_EXPIRES_IN="1d"
GEMINI_API_KEY="your-google-ai-studio-key"
```

### Regla práctica

- `DATABASE_URL`: ruta pensada para la app en runtime.
- `DIRECT_URL`: ruta pensada para migraciones o tareas administrativas cuando quieras evitar el pooler.
- `GEMINI_API_KEY`: credencial emitida por Google AI Studio / Gemini API.

## 7) Configuración mínima de Gemini AI

El backend llama directo a la **Gemini API** usando `@google/generative-ai`.

Dependencias clave:

```bash
pnpm --filter api add @google/generative-ai dotenv
```

Variables esperadas:

```dotenv
GEMINI_API_KEY="your-google-ai-studio-key"
```

Ejemplo conceptual de cliente:

```ts
import { GoogleGenerativeAI } from '@google/generative-ai';

const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
```

## 8) Primer ciclo de Prisma

```bash
cd apps/api
npx prisma migrate dev --name init
npx prisma generate
cd ../..
```

## 9) Estructura mínima sugerida

```text
nutria-labII/
├─ apps/
│  ├─ api/
│  └─ web/
├─ packages/
├─ pnpm-workspace.yaml
├─ turbo.json
└─ package.json
```

## 10) Orden recomendado para el equipo

1. Dejar el monorepo compilando.
2. Verificar que `apps/api` conecta con Neon.
3. Verificar que `apps/web` arranca.
4. Crear la base de módulos compartidos.
5. Recién después empezar auth, CRUD e IA.
