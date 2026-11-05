import Link from 'next/link';
import { BrandLogo } from '@/components/brand';

export default function Home() {
  return (
    <div className="min-h-dvh bg-surface">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <BrandLogo />
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/entrar" className="rounded-md px-3 py-2 font-medium text-ink-2 hover:bg-sunken">
            Entrar
          </Link>
          <Link href="/cadastro" className="rounded-md bg-brand px-4 py-2 font-medium text-white hover:bg-brand-strong">
            Cadastrar loja
          </Link>
        </nav>
      </header>

      <main className="mx-auto grid max-w-6xl items-center gap-14 px-6 pb-20 pt-10 lg:grid-cols-[1.1fr_1fr] lg:pt-20">
        <div>
          <p className="text-[0.8125rem] font-medium text-brand">Para açaiterias, hamburguerias, pizzarias e restaurantes</p>
          <h1 className="mt-4 max-w-xl text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.035em] text-ink sm:text-[3.25rem]">
            Cada pedido vira uma comanda no seu painel, na hora.
          </h1>
          <p className="mt-5 max-w-lg text-[1.0625rem] leading-relaxed text-muted">
            Cardápio digital com link próprio, pedidos chegando em tempo real com aviso sonoro, cozinha e balcão vendo o mesmo quadro e a equipe com o acesso certo para cada função.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/cadastro" className="inline-flex h-12 items-center rounded-lg bg-brand px-6 font-semibold text-white hover:bg-brand-strong">
              Criar minha loja
            </Link>
            <Link href="/entrar" className="inline-flex h-12 items-center rounded-lg border border-line-strong px-6 font-semibold text-ink hover:bg-canvas">
              Já tenho conta
            </Link>
          </div>
          <dl className="mt-12 grid max-w-xl gap-6 border-t border-line pt-8 sm:grid-cols-3">
            {[
              ['Cardápio digital', 'Produtos, tamanhos e adicionais com regras de escolha.'],
              ['Pedidos ao vivo', 'Quadro por etapa, histórico e impressão de comanda.'],
              ['Equipe', 'Funções e permissões por módulo, com registro de ações.'],
            ].map(([t, d]) => (
              <div key={t}>
                <dt className="text-sm font-semibold">{t}</dt>
                <dd className="mt-1 text-[0.8125rem] leading-relaxed text-muted">{d}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Exemplo ilustrativo de uma comanda do painel. */}
        <figure aria-label="Exemplo de comanda no painel" className="mx-auto w-full max-w-sm">
          <div className="ticket-edge rotate-[1.5deg] rounded-b-xl border-x border-b border-line bg-surface px-6 pb-6 pt-8 shadow-pop">
            <div className="flex items-start justify-between">
              <span className="num text-[2.75rem] leading-none font-semibold tracking-[-0.05em]">#128</span>
              <span className="num rounded bg-warn-soft px-1.5 py-0.5 text-[0.6875rem] font-medium text-warn">14:52</span>
            </div>
            <p className="mt-3 text-sm font-medium">Marina</p>
            <p className="text-xs text-muted">Entrega · Jardim Botânico</p>
            <ul className="mt-4 space-y-1.5 border-t border-dashed border-line-strong pt-3 text-[0.8125rem]">
              <li>
                <span className="num mr-1.5 text-xs text-muted">2×</span>Açaí 500 ml
                <span className="block pl-6 text-xs text-muted">Granola · Banana · Nutella ×2</span>
              </li>
              <li>
                <span className="num mr-1.5 text-xs text-muted">1×</span>Água com gás
              </li>
            </ul>
            <div className="mt-4 flex items-baseline justify-between text-xs text-muted">
              <span>PIX</span>
              <span className="num text-sm font-medium text-ink">R$ 58,00</span>
            </div>
            <div className="mt-4 flex h-9 items-center justify-center rounded-md bg-brand text-[0.8125rem] font-medium text-white">Confirmar →</div>
          </div>
          <figcaption className="mt-6 text-center text-xs text-faint">Exemplo de comanda no quadro de pedidos</figcaption>
        </figure>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-xs text-muted">
          <span>Balcão</span>
          <span className="flex gap-4">
            <Link href="/termos" className="hover:text-ink">
              Termos de uso
            </Link>
            <Link href="/privacidade" className="hover:text-ink">
              Privacidade
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
