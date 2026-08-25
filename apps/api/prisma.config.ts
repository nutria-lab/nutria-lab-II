
import "dotenv/config";
import { defineConfig } from "prisma/config";

const isGenerate = process.argv.includes("generate");
const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;

// El flujo de generación (prisma generate) ocurre durante el build (e.g. en CI), 
// momento en el cual puede no haber una conexión disponible.
// Solo exigimos la variable de entorno para migraciones o tiempo de ejecución.
if (!databaseUrl && !isGenerate) {
  throw new Error("Missing required environment variable: DIRECT_URL or DATABASE_URL must be defined.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Prisma generate requiere un string válido aunque no se conecte
  datasource: { url: databaseUrl || "postgresql://dummy:dummy@localhost/dummy" },
});
