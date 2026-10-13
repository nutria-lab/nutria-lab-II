// Sin statement_timeout de arranque (pooler PgBouncer de Neon): el límite lo dan query_timeout y el connect timeout.
import { Client } from 'pg';

export const HEALTH_DB_TIMEOUT_MS = 2000;
export const HEALTH_RESULT_TTL_MS = 5000;

export interface DbHealthProbe {
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
