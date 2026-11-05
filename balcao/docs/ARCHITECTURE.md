# Arquitetura do Balcão

Este documento descreve como a plataforma está organizada, as decisões tomadas na Fase 1 e o que
cada fase seguinte precisa construir. A regra que guia tudo: **o sistema não pode fingir**. Nada é
dado como pago, enviado ou confirmado sem que tenha realmente acontecido, e nenhuma tela existe só
para enfeitar.

---

## 1. Visão geral

```
                ┌──────────────────────── navegador ────────────────────────┐
                │  Painel (/painel/*)      Cardápio (/:loja, /:loja/*)       │
                └───────────────┬──────────────────────────────▲───────────┘
                                │ HTTP (mesma origem /api)     │ WebSocket (ticket assinado)
                ┌───────────────▼──────────────┐               │
                │  apps/web  · Next.js 16      │               │
                │  - páginas do painel (client)│               │
                │  - cardápio renderizado no   │               │
                │    servidor (SEO, rapidez)   │               │
                │  - repassa /api e /uploads   │               │
                └───────────────┬──────────────┘               │
                                │                              │
                ┌───────────────▼──────────────────────────────┴───────────┐
                │  apps/api · Fastify 5 (Node 22)                           │
                │  módulos: auth · settings · catalog · menu (público) ·    │
                │  orders · dashboard · team · uploads · realtime           │
                │  plugins: sessão/tenant · CSRF · rate limit · auditoria   │
                └───────┬───────────────────────────────┬──────────────────┘
                        │ SQL (Drizzle ORM)             │ LISTEN/NOTIFY
                ┌───────▼───────────────────────────────▼──────────────────┐
                │  PostgreSQL 16                                            │
                └──────────────────────────────────────────────────────────┘

packages/shared · regras de domínio usadas pelos dois lados (preço, status, permissões, horários,
validações). A API é sempre a autoridade; o front usa as mesmas regras para mostrar prévias e
validar formulários antes de enviar.
```

### Por que essa divisão

- **API separada do front**: as integrações das próximas fases (WhatsApp Cloud API, gateways de
  pagamento, filas, IA) recebem webhooks e rodam trabalhos em segundo plano. Isso pertence a um
  serviço Node de longa duração, não às rotas do Next.js.
- **Next.js no front**: o cardápio público é renderizado no servidor (rápido no 4G, indexável,
  pré-visualização bonita no WhatsApp), e o painel é uma aplicação interativa com cache de dados
  (TanStack Query).
- **Pacote compartilhado em TypeScript puro**: uma única implementação do cálculo de preço, das
  transições de status e do modelo de permissões. Não há como o carrinho mostrar um valor e a API
  cobrar outro por divergência de regra.

---

## 2. Multiempresa (multi-tenant)

- Cada estabelecimento é um `tenant`. Tudo que pertence a ele tem `tenant_id`.
- **O tenant vem sempre da sessão do usuário**, nunca de parâmetros da requisição. As rotas do
  painel resolvem `tenantCtx` no `preHandler` (`plugins/context.ts`) e todas as consultas filtram por
  `tenant_id`.
- **Chaves estrangeiras compostas `(tenant_id, id)`**: produto → categoria, item de pedido →
  produto, pedido → cliente, adicional → grupo etc. O próprio PostgreSQL recusa qualquer referência
  cruzada entre empresas, mesmo que uma consulta da aplicação tenha um erro. Há teste cobrindo isso.
- Unidades (`branches`) já existem no modelo desde a Fase 1: pedidos, horários, regras de entrega e
  numeração são por unidade; o cabeçalho troca de unidade quando houver mais de uma. A criação e a
  visão consolidada de várias unidades são da Fase 5.
- Um mesmo usuário pode pertencer a várias empresas (`memberships`) e alternar entre elas.

### Próximo passo de defesa em profundidade (Fase 5)

Ativar Row-Level Security do PostgreSQL com `SET LOCAL app.tenant_id` por transação. O modelo já
está pronto para isso (todas as tabelas têm `tenant_id`).

---

## 3. Módulos

| Módulo | Responsabilidade | Fase | Situação |
|---|---|---|---|
| Authentication | Cadastro, login, sessão, recuperação de senha, convites | 1 | ✅ |
| Tenants | Dados da empresa, identidade do cardápio | 1 | ✅ |
| Branches | Unidade: endereço, fuso, horários, pausa, regras de pedido | 1 | ✅ (uma unidade por loja na UI) |
| Users / Team | Equipe, funções, permissões por módulo, convites, auditoria | 1 | ✅ |
| Catalog / Products | Categorias, produtos, grupos de adicionais, estoque simples | 1 | ✅ |
| Menu (público) | Cardápio digital, sacola, finalização, acompanhamento | 1 | ✅ |
| Orders | Recebimento, quadro, status, edição, histórico, impressão | 1 | ✅ |
| Dashboard | Indicadores, gráficos, atividade recente | 1 | ✅ |
| Notifications | Aviso sonoro e lista de pedidos novos no painel | 1 | ✅ parcial (central completa na Fase 2) |
| WhatsApp | Integração oficial Cloud API, envio de atualizações | 2 | ⏳ |
| AI Assistant | Atendente virtual com acesso controlado ao cardápio | 2 | ⏳ |
| Inbox | Central de conversas (lista, chat, ficha do cliente) | 2 | ⏳ |
| Kitchen | Painel de produção para telas grandes/tablets | 2 | ⏳ |
| Delivery | Bairros e taxas, entregadores, painel de entregas | 2 | ⏳ |
| Payments | Gateways (Mercado Pago, Stripe…), PIX dinâmico, webhooks | 2 | ⏳ |
| Customers / CRM | Ficha única, segmentos, etiquetas, LGPD (exportar/excluir) | 3 | ⏳ |
| Marketing | Campanhas com opt-in, automações | 3 | ⏳ |
| Coupons / Promotions | Cupons e promoções | 3 | ⏳ |
| Loyalty | Cashback e pontos | 3 | ⏳ |
| Inventory | Insumos, fichas técnicas, movimentações | 4 | ⏳ |
| Financial | Contas a pagar/receber, fluxo de caixa | 4 | ⏳ |
| Cash Register | Abertura e fechamento de caixa | 4 | ⏳ |
| Reports | Relatórios com exportação CSV/Excel/PDF | 4 | ⏳ |
| Subscriptions | Planos, limites, cobrança recorrente | 5 | ⏳ |
| Platform Administration | Painel do superadministrador | 5 | ⏳ |

O registro de módulos (`packages/shared/src/permissions.ts`) já inclui os das próximas fases com o
número da fase. Assim, permissões, menu lateral e (na Fase 5) planos nascem preparados: quando um
módulo for construído, basta mudar `CURRENT_PHASE`/a fase do módulo e criar suas rotas e telas.

Cada módulo da API vive em `apps/api/src/modules/<módulo>/` com `routes.ts` (HTTP, validação,
permissão) e, quando há regra relevante, `service.ts` (regra de negócio e transações).

---

## 4. Modelo de dados (Fase 1)

Tabelas criadas na migração `apps/api/drizzle/0000_init.sql`:

| Tabela | Observações |
|---|---|
| `tenants` | slug único (link do cardápio), dados fiscais, identidade visual, modelos de mensagem |
| `branches` | endereço, fuso, tipos de atendimento, taxas, tempos, formas de pagamento, chave PIX, pausa, contador de pedidos |
| `opening_hours` | intervalos por dia da semana (aceita virar a meia-noite) |
| `users` | e-mail único, hash scrypt, flag de superadmin |
| `memberships` | usuário × empresa: função, status (convidado/ativo/desativado), permissões personalizadas, unidades permitidas |
| `sessions` | token opaco (só o hash no banco), empresa/unidade ativa, expiração deslizante |
| `auth_tokens` | links de redefinição de senha e de convite (uso único, com validade) |
| `categories` · `products` · `modifier_groups` · `modifiers` · `product_modifier_groups` | cardápio; grupos reutilizáveis entre produtos; exclusão lógica para preservar histórico |
| `customers` · `customer_addresses` | cliente único por telefone dentro da empresa; consentimento de marketing com data |
| `orders` | número sequencial por unidade, token público de acompanhamento, chave de idempotência única, valores em centavos com `CHECK` de consistência, carimbo de cada etapa |
| `order_items` · `order_item_modifiers` | cópia (snapshot) de nome e preço no momento do pedido |
| `order_events` | histórico do pedido: criação, status, edição de itens, descontos, pagamento, notas, impressão, aviso ao cliente |
| `audit_logs` | quem fez, o quê, quando, em qual empresa, de qual IP |
| `uploads` | imagens enviadas por empresa (base para cota de armazenamento por plano) |

Entidades listadas no escopo e previstas para as próximas fases: `product_variations` (na Fase 1
tamanhos são grupos de adicionais de escolha única), `payments`, `coupons`, `campaigns`,
`loyalty_accounts`, `loyalty_transactions`, `inventory_items`, `inventory_movements`, `recipes`,
`suppliers`, `expenses`, `cash_registers`, `cash_movements`, `delivery_zones`, `couriers`,
`conversations`, `messages`, `ai_settings`, `notifications`, `subscriptions`/`plans`.
Todas seguem o mesmo padrão: `tenant_id`, chave composta e migração nova (nunca editar uma
migração já aplicada).

### Dinheiro

Sempre **centavos inteiros**. Somas no banco são feitas em `bigint` e convertidas com cuidado. A
tabela `orders` tem `CHECK (total = subtotal − desconto + taxa)` e `order_items` tem
`CHECK (total = unitário × quantidade)`: um valor inconsistente não chega a ser gravado.

---

## 5. Pedidos

### Criação (cardápio público e lançamento manual)

`apps/api/src/modules/orders/service.ts → createOrder`

1. **Idempotência**: o navegador gera uma chave por tentativa (guardada na sessão do navegador).
   Reenvio, duplo toque ou rede instável devolvem o mesmo pedido. Há restrição única
   `(tenant_id, idempotency_key)` e tratamento de corrida (envios simultâneos).
2. **Regras da loja** (só no cardápio público): horário de funcionamento no fuso da unidade, pausa
   manual, tipos de atendimento aceitos, formas de pagamento aceitas, pedido mínimo para entrega.
3. **Preço recalculado no servidor** a partir do cardápio gravado (`priceItem` do pacote
   compartilhado): adicionais precisam pertencer ao produto, estar disponíveis e respeitar mínimo,
   máximo e quantidade por opção. Qualquer valor enviado pelo cliente é ignorado.
4. Em uma transação: cliente (upsert por telefone) e endereço, **reserva de estoque**
   (`UPDATE … WHERE estoque >= quantidade`, sem venda acima do disponível), número sequencial da
   unidade, pedido, itens, histórico e evento em tempo real.
5. Status inicial: `new` (aguarda a loja) ou `confirmed` se a confirmação automática estiver ligada.
   Pedidos lançados pela equipe já entram confirmados.

### Status

```
new ─┬─> awaiting_confirmation ─> confirmed
     └─> confirmed ─> preparing ─> ready ─┬─> out_for_delivery ─> completed   (entrega)
                                          └─> completed                       (retirada/local)
qualquer etapa ativa ─> canceled (com motivo; devolve o estoque reservado)
```

- Transições validadas no servidor (`canTransition`). Pedido de entrega só conclui depois de sair.
- Linha travada com `SELECT … FOR UPDATE`; o painel envia o status que estava vendo
  (`expectedFrom`) e a API recusa com 409 se outra pessoa já mudou: ninguém sobrescreve ninguém.
- Cancelar, dar desconto e alterar taxa exigem nível **Administrar** no módulo Pedidos.
- Toda alteração gera um `order_event`; cancelamentos e descontos também vão para `audit_logs`.

### Tempo real

- A API publica eventos com `pg_notify` **dentro da transação**: o evento só sai se a gravação for
  confirmada. Cada instância da API escuta o canal com `LISTEN` e repassa aos WebSockets da empresa.
  Funciona com várias instâncias sem Redis.
- O WebSocket abre com um **ticket assinado (HMAC) de 60 s** emitido para a sessão autenticada; a
  API confere sessão e vínculo antes de aceitar e filtra eventos de pedido por permissão.
- Se a conexão cair, o painel reconecta com espera crescente e passa a consultar a cada 20 s.

### Comunicação com o cliente na Fase 1

Sem integração com WhatsApp ainda, o botão **Avisar no WhatsApp** abre o WhatsApp da equipe com a
mensagem personalizada pronta (link `wa.me`). O histórico registra “mensagem aberta para envio”,
não “mensagem enviada”, porque o sistema não tem como saber se foi enviada. Na Fase 2, os mesmos
modelos de mensagem serão enviados pela Cloud API, com status de entrega vindo do webhook.

### Pagamento na Fase 1

Formas presenciais (PIX, dinheiro, cartões, vale-refeição). A chave PIX da loja aparece para o
cliente; **a equipe só marca como recebido depois de conferir no banco**. A forma `online` existe
no modelo, mas não pode ser escolhida até haver um provedor integrado, e a API recusa marcar como
pago um pagamento online manualmente: isso só poderá vir do webhook do provedor.

---

## 6. Permissões

- Funções: proprietário, administrador, gerente, atendente, operador de caixa, cozinha,
  entregador (o superadministrador da plataforma é uma flag no usuário).
- Cada módulo tem um nível por pessoa: **sem acesso < visualizar < editar < administrar**.
- Cada função tem um padrão (`ROLE_DEFAULTS`); o proprietário e administradores podem personalizar
  por módulo. O proprietário sempre tem acesso total.
- Proteções: ninguém altera a própria função; gerente não promove a administrador; o último
  proprietário ativo não pode ser rebaixado nem desativado; desativar ou remover alguém encerra o
  contexto das sessões dessa pessoa na empresa.
- O front só esconde botões; **toda verificação vale no servidor**.

---

## 7. Segurança e LGPD

| Tema | Como está |
|---|---|
| Senhas | scrypt (N=2¹⁵, r=8, p=3), sal aleatório, comparação em tempo constante; tempo semelhante para e-mail inexistente |
| Sessão | token aleatório de 256 bits em cookie `httpOnly` `SameSite=Lax` (`Secure` em produção); só o hash SHA-256 no banco; expiração deslizante de 30 dias; troca/redefinição de senha encerra as outras sessões |
| CSRF | requisições que alteram dados exigem o cabeçalho `x-balcao-client` (impossível de enviar de outro site sem CORS, que a API não habilita) e `Origin` confiável |
| Rate limit | global por IP, e mais restrito em cadastro, login, recuperação de senha, convites, envio de pedido e upload |
| Enumeração | “Esqueci a senha” responde igual para e-mails existentes ou não; login não diz qual dado errou |
| Validação | todas as entradas passam por schemas Zod compartilhados; SQL sempre parametrizado (Drizzle) |
| Uploads | só JPG/PNG/WEBP, identificados pelos bytes do arquivo (não pela extensão), até 5 MB, nome aleatório, servidos com cabeçalhos restritivos |
| XSS | React escapa conteúdo; a API responde só JSON com CSP `default-src 'none'`; o app web envia `X-Frame-Options`, `nosniff`, `Referrer-Policy` |
| Dados públicos | o acompanhamento do pedido usa token aleatório e não expõe notas internas nem nomes da equipe (há teste) |
| Auditoria | `audit_logs` com autor, ação, resumo, mudanças, IP e navegador; tela “Registro de atividades” |
| LGPD | consentimento de marketing explícito e datado no pedido; dados mínimos; política de privacidade publicada; exportação/correção/exclusão de dados do cliente entram com o CRM (Fase 3) |

---

## 8. Integrações (camada preparada)

Padrão para cada integração das próximas fases:

- Configuração por empresa (credenciais criptografadas em repouso, nunca devolvidas ao front).
- Cliente HTTP isolado em `apps/api/src/integrations/<provedor>/` com tempo limite e novas tentativas.
- **Webhooks** em `/api/webhooks/<provedor>` com verificação de assinatura, gravação do evento bruto
  e processamento idempotente (mesma ideia da chave de pedido).
- Trabalhos em fila (ex.: `pg-boss` sobre o próprio PostgreSQL, ou Redis/BullMQ em escala).
- Estado de conexão visível no painel; nada é dado como enviado/pago sem confirmação do provedor.

Já existem nesta fase:

| Integração | Situação |
|---|---|
| E-mail transacional | Resend via HTTP (`services/mailer.ts`). Sem chave: em desenvolvimento a mensagem vai para o log; em produção o envio falha com erro claro e o convite mostra o link para copiar |
| Armazenamento | driver local (`services/storage.ts`). Interface pronta para um driver S3 compatível |
| Impressão | comanda otimizada para impressora térmica de 80 mm pelo navegador; integração direta (ESC/POS) fica para a Fase 2 |

---

## 9. Roteiro das próximas fases

**Fase 2 · Operação e atendimento**
- WhatsApp Business Platform (Cloud API): conexão por empresa (Embedded Signup), webhook de
  mensagens e status, envio dos modelos de mensagem ao mudar o status do pedido, janela de 24 h e
  templates aprovados.
- Central de atendimento: `conversations`, `messages`, transferência humano/IA, notas internas.
- Assistente de IA: ferramentas com acesso somente leitura ao cardápio, preços e horários; cria o
  pedido pelo mesmo `createOrder` (as mesmas regras e a mesma idempotência), sempre confirmando o
  resumo com o cliente; transferência automática por regras.
- Painel da cozinha (telas grandes, um toque por etapa), entregas (bairros/taxas, entregadores,
  atribuição) e pagamentos online (PIX dinâmico com QR Code e confirmação só por webhook).

**Fase 3 · Gestão comercial**: CRM com ficha única e segmentos, LGPD (exportar/corrigir/excluir),
cupons e promoções (aplicados dentro de `createOrder`), campanhas com opt-in/opt-out, cashback e
pontos com livro-razão de movimentações.

**Fase 4 · Gestão administrativa**: insumos e fichas técnicas com baixa em etapa configurável (um
único ponto de baixa por pedido, evitando consumo duplicado), financeiro, caixa e relatórios
exportáveis.

**Fase 5 · Plataforma SaaS**: superadministrador, planos e limites configuráveis sem código,
assinaturas e cobrança recorrente, múltiplas unidades com visão consolidada, RLS e monitoramento.

---

## 10. Limitações conhecidas da Fase 1

- Uma unidade por empresa na interface (o modelo e a API já trabalham por unidade).
- Taxa de entrega única; taxa por bairro/distância vem com o módulo Entregas.
- Estoque por produto (quantidade simples). Insumos e fichas técnicas vêm na Fase 4.
- Ao editar os itens de um pedido, os preços são recalculados com o cardápio atual.
- Arquivos enviados ficam no disco do servidor; para várias instâncias, usar o driver S3.
- O limite de requisições guarda contadores na memória de cada instância; em escala, usar Redis.
