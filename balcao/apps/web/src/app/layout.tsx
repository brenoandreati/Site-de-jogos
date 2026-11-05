import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/schibsted-grotesk';
import '@fontsource-variable/martian-mono';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: 'Balcão', template: '%s · Balcão' },
  description: 'Pedidos, cardápio digital e gestão para açaiterias, hamburguerias, pizzarias e restaurantes.',
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#f5f5f2',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
