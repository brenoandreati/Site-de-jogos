/** Endereços que não podem ser usados como link de loja (conflitam com rotas da plataforma). */
export const RESERVED_SLUGS = new Set([
  'api', 'app', 'admin', 'painel', 'entrar', 'login', 'cadastro', 'cadastrar', 'sair', 'logout',
  'recuperar-senha', 'redefinir-senha', 'convite', 'plataforma', 'superadmin', 'static', 'assets',
  'uploads', 'public', '_next', 'favicon.ico', 'robots.txt', 'sitemap.xml', 'termos', 'privacidade',
  'ajuda', 'suporte', 'planos', 'precos', 'blog', 'status', 'www', 'balcao', 'pedido', 'pedidos',
]);

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;

export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 48)
    .replace(/-+$/g, '');
}

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && !RESERVED_SLUGS.has(slug) && !slug.includes('--');
}
