// NUT-85 — Sonda de DB para GET /health (design D10): SELECT 1 en una conexión efímera, liberada siempre.
// Sin statement_timeout de arranque (PgBouncer de Neon, D27): el límite lo dan query_timeout y el connect timeout.
import { Client } from 'pg';

export const HEALTH_DB_TIMEOUT_MS = 2000;
/** Ventana en la que se reutiliza el último resultado de la sonda (single-flight + caché corta, D28). */
export const HEALTH_RESULT_TTL_MS = 5000;

export interface DbHealthProbe {
  /** Resuelve si la DB respondió SELECT 1; rechaza en cualquier otro caso. */
  ping(): Promise<void>;
}

export class PgDbHealthProbe implements DbHealthProbe {
  constructor(
    private readonly connectionString: string | undefined,
    private readonly timeoutMs: number = HEALTH_DB_TIMEOUT_MS,
  ) {}

  async ping(): Promise<void> {
    if (!this.connectionString) throw new Error('HEALTH_DB_URL_MISSING');
    const client = new Client({
      connectionString: this.connectionString,
      connectionTimeoutMillis: this.timeoutMs,
      query_timeout: this.timeoutMs,
    });
    // Sin listener, un error asíncrono del socket tiraría el proceso.
    client.on('error', () => undefined);
    try {
      await client.connect();
      await client.query('SELECT 1');
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}
