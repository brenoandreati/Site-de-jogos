import { buildApp } from './app';
import { loadConfig } from './config';
import { runMigrations } from './db/migrate';

async function main() {
  const config = loadConfig();
  if (process.env.MIGRATE_ON_START === 'true') {
    await runMigrations(config.DATABASE_URL);
  }
  const app = await buildApp(config);

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} recebido, encerrando`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.API_PORT, host: config.API_HOST });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
