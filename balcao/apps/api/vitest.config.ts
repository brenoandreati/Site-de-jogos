import { defineConfig } from 'vitest/config';

const env = {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://balcao:balcao@localhost:5432/balcao_test',
  APP_URL: 'http://localhost:3000',
  SESSION_SECRET: 'test-secret-test-secret-test-secret-1234',
  UPLOAD_DIR: '/tmp/balcao-test-uploads',
  LOG_LEVEL: 'silent',
  WHATSAPP_APP_SECRET: 'meta-app-secret-de-teste',
  WHATSAPP_VERIFY_TOKEN: 'verificacao-de-teste',
};
// O globalSetup roda no processo principal: as variáveis precisam existir aqui também.
Object.assign(process.env, env);

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    env,
  },
});
