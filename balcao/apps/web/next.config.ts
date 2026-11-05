import type { NextConfig } from 'next';
import path from 'node:path';

// Usa o mesmo .env da raiz do monorepo.
try {
  process.loadEnvFile(path.resolve(process.cwd(), '../../.env'));
} catch {
  /* sem .env: usa variáveis do ambiente */
}

const api = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  transpilePackages: ['@balcao/shared'],
  poweredByHeader: false,
  agentRules: false,
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${api}/api/:path*` },
      { source: '/uploads/:path*', destination: `${api}/uploads/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
