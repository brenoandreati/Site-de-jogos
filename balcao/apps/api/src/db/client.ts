import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
/** Transação ou conexão: as funções de serviço aceitam ambos. */
export type DbExecutor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export function createPool(url: string) {
  return new pg.Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
  });
}

export function createDb(pool: pg.Pool): Database {
  return drizzle(pool, { schema, casing: 'snake_case' });
}

export { schema };
