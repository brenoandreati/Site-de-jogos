# Balcão

Plataforma SaaS de pedidos, cardápio digital e gestão para negócios de alimentação (açaiterias,
hamburguerias, pizzarias, restaurantes). Multiempresa desde o primeiro dia.

Entregas até aqui:

- **Fase 1 · estrutura principal**: um estabelecimento se cadastra, monta o cardápio com tamanhos e
  adicionais, divulga o link e recebe pedidos em tempo real no painel.
- **Fase 2 · operação e atendimento**: painel da cozinha, entregas (bairros, taxas e entregadores),
  central de atendimento com o WhatsApp oficial (Cloud API da Meta), avisos automáticos de pedido,
  assistente de IA que atende e registra pedidos, e PIX online pelo Mercado Pago.

A arquitetura e o roteiro das fases 3 a 5 estão em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

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

**Operação e atendimento** (Fase 2)
- Cozinha (`/painel/cozinha`): fila em comandas grandes para tela ou tablet, um toque por etapa
  (iniciar preparo, pronto), cronômetro contra a meta de preparo, aviso sonoro, tela cheia e
  impressão. Sem telefone nem valores do cliente na tela da cozinha.
- Entregas (`/painel/entregas`): painel por situação (aguardando entregador, com entregador, em rota,
  com problema), atribuição, saída só de pedido pronto, entregue, ocorrências com motivo, link do
  mapa, troco a levar; cadastro de entregadores com histórico e vínculo ao acesso de quem tem a
  função Entregador (que vê só as próprias entregas no celular); bairros com taxa, pedido mínimo e
  tempo próprios, usados no cardápio e no lançamento manual.
- Atendimento (`/painel/atendimento`): conversas do WhatsApp em tempo real com filtros (aguardando,
  não lidas, minhas, com a IA, equipe, encerradas) e busca; mensagens com situação de envio
  (enviada, entregue, lida, falhou com o motivo da Meta), imagens, respostas rápidas com `/atalho`,
  notas internas, assumir, transferir, devolver para a IA, encerrar e reabrir; ficha do cliente com
  pedidos, etiquetas e observações. Respeita a janela de 24 h da WhatsApp.
- Avisos automáticos: a cada mudança de etapa o cliente recebe a mensagem da loja pela Cloud API
  (texto dentro da janela de 24 h; fora dela, só com modelo aprovado configurado). O histórico do
  pedido registra se o aviso foi enviado, falhou ou não pôde ser enviado, e por quê.
- Assistente de IA (`/painel/assistente`): nome, tom, personalidade, saudação, mensagem com a loja
  fechada, instruções, regras de venda e restrições, produtos para recomendar, perguntas frequentes
  e regras de transferência para a equipe. Consulta cardápio, preços e disponibilidade no sistema,
  monta o pedido, confirma o resumo com o cliente e só então registra (pelo mesmo fluxo do
  cardápio). Conversa de teste no painel, que nunca registra pedidos, e uso dos últimos 30 dias.
- PIX online (Mercado Pago): QR Code e copia e cola na tela de acompanhamento, com prazo; o pedido só
  vai para a loja quando o Mercado Pago confirma (webhook assinado e consulta direta ao provedor);
  vencimento cancela a cobrança e o pedido; cancelar o pedido cancela a cobrança; estorno pelo painel.
- Integrações (`/painel/configuracoes?secao=integracoes`): conexão do WhatsApp oficial e do
  Mercado Pago, com credenciais conferidas no provedor antes de salvar e guardadas criptografadas.

**Cardápio digital** (`/sua-loja`)
- Aberto/fechado pelo horário da loja, tempo estimado, taxa, destaques, busca, categorias fixas no topo.
- Produto com escolhas obrigatórias/opcionais validadas, observações, sacola que guarda os itens.
- Finalização com entrega, retirada ou consumo no local, endereço, bairro com a taxa dele, troco,
  chave PIX ou PIX online, consentimento para promoções e opção de lembrar os dados.
- Acompanhamento do pedido em tempo quase real, com as etapas e horários, o PIX para pagar (quando
  online) e contato com a loja.

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
│   ├── api/          API REST + WebSocket (módulos em src/modules/*), integrações em
│   │                 src/integrations/*, fila de tarefas, migrações em drizzle/
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

Integrações em desenvolvimento: a Meta e o Mercado Pago precisam alcançar os webhooks por HTTPS.
Use um túnel (ex.: `cloudflared tunnel --url http://localhost:3000`) e coloque a URL em
`PUBLIC_WEBHOOK_URL`. Sem `ANTHROPIC_API_KEY`, o assistente de IA aparece como indisponível e as
conversas ficam com a equipe; sem as credenciais do app Meta, não é possível conectar números.

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

Na Fase 2, com a Meta, o Mercado Pago e a IA substituídos por provedores falsos nos testes:
cozinha e conflitos de etapa; bairros obrigatórios e taxa/mínimo por bairro; atribuição, saída só
de pedido pronto e visão restrita do entregador; webhook da WhatsApp com assinatura, mensagens
repetidas ignoradas, status que não regride, transferência por palavra-chave, janela de 24 h e
avisos automáticos (enviado, fora da janela, com modelo); IA que consulta o cardápio, só registra
depois da confirmação, não duplica o pedido e nunca registra em teste; PIX que só é aprovado pela
consulta ao provedor, recusa de assinatura falsa, idempotência das notificações, vencimento,
cancelamento da cobrança junto com o pedido e estorno.

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
| `ENCRYPTION_KEY` | chave AES-256 (32 bytes em base64) que cifra os tokens das integrações; obrigatória em produção |
| `PUBLIC_WEBHOOK_URL` | endereço HTTPS pelo qual Meta e Mercado Pago chegam aos webhooks (padrão: `APP_URL`) |
| `WHATSAPP_APP_SECRET` / `WHATSAPP_VERIFY_TOKEN` | app Meta da plataforma: assinatura dos webhooks e verificação do cadastro do webhook |
| `WHATSAPP_GRAPH_VERSION` | versão da Graph API (padrão `v23.0`) |
| `ANTHROPIC_API_KEY` / `AI_MODEL` | assistente de IA (padrão `claude-opus-5-5`) |

## Produção

- `npm run build` gera `apps/api/dist` e o build do Next.js. Rode as migrações antes de subir
  (`npm run db:migrate`, ou `MIGRATE_ON_START=true` na API).
- Coloque um proxy reverso (Nginx, Caddy, load balancer) servindo o app web e encaminhando `/api`
  (inclusive o upgrade de WebSocket) e `/uploads` para a API, com HTTPS. Assim tudo fica na mesma
  origem e `NEXT_PUBLIC_WS_URL` pode ficar vazio.
- Defina `NODE_ENV=production`, um `SESSION_SECRET` forte, `ENCRYPTION_KEY`, `APP_URL` com https e
  `TRUST_PROXY` com o IP do proxy.
- WhatsApp: crie um app na Meta (produto WhatsApp), cadastre o webhook
  `https://SEU_DOMINIO/api/webhooks/whatsapp` com o `WHATSAPP_VERIFY_TOKEN` e assine o campo
  `messages`. Cada loja conecta o próprio número em Integrações (identificador do número, da conta
  WhatsApp Business e token permanente de usuário do sistema); a plataforma assina o app na conta
  da loja automaticamente.
- Mercado Pago: cada loja conecta o access token da própria conta e cadastra no Mercado Pago a URL
  de notificações mostrada no painel (evento Pagamentos), colando de volta a assinatura secreta.
- Backups automáticos do PostgreSQL e do diretório de uploads (ou use armazenamento S3).
- Revise os textos de [termos](apps/web/src/app/termos/page.tsx) e
  [privacidade](apps/web/src/app/privacidade/page.tsx) com assessoria jurídica e preencha os dados do
  operador da plataforma.
