import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb, createPool } from './client';

export async function runMigrations(databaseUrl: string) {
  const pool = createPool(databaseUrl);
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // Em desenvolvimento: src/db → ../../drizzle. No build (dist/): dist → ../drizzle.
    const candidates = [path.resolve(here, '../../drizzle'), path.resolve(here, '../drizzle')];
    const { existsSync } = await import('node:fs');
    const migrationsFolder = candidates.find((p) => existsSync(path.join(p, 'meta', '_journal.json')));
    if (!migrationsFolder) throw new Error('Pasta de migrações não encontrada');
    await migrate(createDb(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL não definida');
    process.exit(1);
  }
  runMigrations(url)
    .then(() => {
      console.log('Migrações aplicadas.');
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
