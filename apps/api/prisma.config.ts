
import "dotenv/config";
import { defineConfig } from "prisma/config";

const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Missing required environment variable: DIRECT_URL or DATABASE_URL must be defined.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: databaseUrl },
});
