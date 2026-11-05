# Balcão

Plataforma SaaS de pedidos, cardápio digital e gestão para negócios de alimentação (açaiterias,
hamburguerias, pizzarias, restaurantes). Multiempresa desde o primeiro dia.

Esta entrega é a **Fase 1 — estrutura principal**: um estabelecimento se cadastra, monta o
cardápio com tamanhos e adicionais, divulga o link e recebe pedidos em tempo real no painel. A
arquitetura das fases 2 a 5 está descrita em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## O que já funciona

**Painel da loja** (`/painel`)
- Cadastro da loja com link próprio (`dominio.com/sua-loja`), login, recuperação de senha, troca de senha.
- Visão geral: faturamento (do período, do dia e do mês), pedidos, ticket médio, clientes novos e
  recorrentes, cancelados, comparação com o período anterior, pedidos agora por etapa, gráfico por
  hora/dia, mais vendidos, vendas por categoria, pagamento, canal e tipo de atendimento, atividade recente
  e roteiro de primeiros passos.
- Pedidos: quadro por etapa atualizado em tempo real com aviso sonoro, cronômetro que muda de cor
  quando atrasa, confirmar/recusar, avançar etapas, cancelar com motivo, editar itens, desconto,
  trocar pagamento, registrar recebimento, observações internas, histórico completo, duplicar,
  imprimir comanda de 80 mm, avisar o cliente no WhatsApp com mensagem pronta, histórico com busca
  e filtros, lançamento manual (balcão, telefone, WhatsApp, Instagram).
- Cardápio: categorias, produtos com foto, preço, código, tempo de preparo, destaque, disponibilidade
  e estoque simples; grupos de adicionais reutilizáveis com mínimo, máximo e quantidade por opção;
  ordenação; duplicar; pausar produto com um toque.
- Funcionários: convites por link, funções (proprietário, administrador, gerente, atendente, caixa,
  cozinha, entregador), permissões por módulo, desativar/remover, registro de atividades.
- Configurações: dados da empresa (CPF/CNPJ, inclusive o CNPJ alfanumérico), logo, capa e cor do
  cardápio, endereço, fuso, horários por dia (com intervalos e madrugada), pausa temporária,
  entrega/retirada/consumo no local, confirmação automática, tempos, taxa, pedido mínimo, entrega
  grátis acima de, formas de pagamento, chave PIX, política de cancelamento e mensagens ao cliente.

**Cardápio digital** (`/sua-loja`)
- Aberto/fechado pelo horário da loja, tempo estimado, taxa, destaques, busca, categorias fixas no topo.
- Produto com escolhas obrigatórias/opcionais validadas, observações, sacola que guarda os itens.
- Finalização com entrega, retirada ou consumo no local, endereço, troco, chave PIX, consentimento
  para promoções e opção de lembrar os dados.
- Acompanhamento do pedido em tempo quase real, com as etapas e horários, e contato com a loja.

## Stack

| Camada | Tecnologia |
|---|---|
| Front | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, TanStack Query |
| API | Node.js 22, Fastify 5, WebSocket, Zod |
| Banco | PostgreSQL 16, Drizzle ORM (migrações SQL versionadas) |
| Compartilhado | `@balcao/shared`: regras de preço, status, permissões, horários e validações |
| Testes | Vitest (unitários e integração com banco real), Playwright (fluxo completo no navegador) |

```
balcao/
├── apps/
│   ├── api/          API REST + WebSocket (módulos em src/modules/*), migrações em drizzle/
│   └── web/          painel e cardápio digital
├── packages/shared/  domínio compartilhado
├── e2e/              teste de ponta a ponta no navegador
└── docs/             arquitetura e roteiro
```

## Como rodar

Requisitos: Node.js 22+ e PostgreSQL 16 (ou Docker).

```bash
cd balcao
cp .env.example .env            # ajuste SESSION_SECRET (openssl rand -base64 48)
docker compose up -d            # sobe o PostgreSQL com os bancos balcao e balcao_test
npm install
npm run db:migrate
npm run dev                     # API em :4000 e painel em :3000
```

Abra http://localhost:3000, clique em **Cadastrar loja** e siga os primeiros passos do painel.
O cardápio fica em `http://localhost:3000/<endereço-da-loja>`.

Sem chave de e-mail (`RESEND_API_KEY`), os links de recuperação de senha aparecem no log da API em
desenvolvimento, e o convite de funcionário mostra o link para copiar e enviar.

## Testes

```bash
npm test                                 # domínio + integração da API (usa o banco balcao_test)
npm run typecheck
BASE_URL=http://localhost:3000 node e2e/fluxo-completo.cjs   # com o sistema rodando e Playwright instalado
```

Os testes de integração cobrem: cadastro e login, CSRF, recuperação de senha de uso único,
isolamento entre empresas (inclusive no banco), recálculo de preço no servidor, adicionais
inválidos ou de outra loja, idempotência com envios simultâneos, horário/pausa/pedido mínimo,
reserva e devolução de estoque, fluxo de status e conflitos, pedido manual com desconto, edição de
itens, eventos em tempo real por empresa, dashboard, convites, permissões e proteção do proprietário.

## Variáveis de ambiente

Veja `.env.example`. As principais:

| Variável | Para quê |
|---|---|
| `DATABASE_URL` | conexão com o PostgreSQL |
| `APP_URL` | endereço público do painel (links de e-mail e de acompanhamento) e origem aceita pela API |
| `SESSION_SECRET` | assina os tickets do WebSocket (mín. 32 caracteres) |
| `TRUST_PROXY` | IPs dos proxies confiáveis, para limitar tentativas pelo IP real do cliente |
| `RESEND_API_KEY` / `EMAIL_FROM` | envio de e-mails transacionais |
| `UPLOAD_DIR` | onde as imagens ficam (driver local) |
| `API_INTERNAL_URL` / `NEXT_PUBLIC_WS_URL` | como o app web encontra a API e o WebSocket |

## Produção

- `npm run build` gera `apps/api/dist` e o build do Next.js. Rode as migrações antes de subir
  (`npm run db:migrate`, ou `MIGRATE_ON_START=true` na API).
- Coloque um proxy reverso (Nginx, Caddy, load balancer) servindo o app web e encaminhando `/api`
  (inclusive o upgrade de WebSocket) e `/uploads` para a API, com HTTPS. Assim tudo fica na mesma
  origem e `NEXT_PUBLIC_WS_URL` pode ficar vazio.
- Defina `NODE_ENV=production`, um `SESSION_SECRET` forte, `APP_URL` com https e `TRUST_PROXY` com o
  IP do proxy.
- Backups automáticos do PostgreSQL e do diretório de uploads (ou use armazenamento S3).
- Revise os textos de [termos](apps/web/src/app/termos/page.tsx) e
  [privacidade](apps/web/src/app/privacidade/page.tsx) com assessoria jurídica e preencha os dados do
  operador da plataforma.
