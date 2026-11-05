import pg from 'pg';
import { runMigrations } from '../src/db/migrate';

/** Recria o banco de testes do zero e aplica as migrações. */
export default async function setup() {
  const url = process.env.DATABASE_URL!;
  if (!/test/.test(new URL(url).pathname)) {
    throw new Error(`Recusando rodar testes num banco que não parece ser de teste: ${url}`);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;');
  await client.end();
  await runMigrations(url);
}
