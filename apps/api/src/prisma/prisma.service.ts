import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    const pool = new Pool({ connectionString, connectionTimeoutMillis: 10_000 });
    const adapter = new PrismaPg(pool, {
      // The adapter does not own an externally supplied pool unless requested.
      // Dispose it on $disconnect so Nest lifecycle restarts don't leak pools.
      disposeExternalPool: true,
      onPoolError: (error) => {
        // pg pool errors can include connection details; keep logs sanitized.
        const code = (error as Error & { code?: string }).code;
        console.error('PostgreSQL connection pool error:', error.name, code);
      },
    });

    super({ adapter });
  }
  
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
