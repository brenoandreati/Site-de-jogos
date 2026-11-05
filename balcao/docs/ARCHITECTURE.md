# Arquitetura do Balcão

Este documento descreve como a plataforma está organizada, as decisões tomadas nas fases 1 e 2 e
o que cada fase seguinte precisa construir. A regra que guia tudo: **o sistema não pode fingir**. Nada é
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
                │  orders · dashboard · team · uploads · realtime ·         │
                │  kitchen · delivery · inbox · ai · integrations ·         │
                │  payments · webhooks                                      │
                │  plugins: sessão/tenant · CSRF · rate limit · auditoria   │
                │  fila de tarefas (jobs) · cofre de credenciais            │
                └───┬───────────────────────────┬───────────────┬──────────┘
                    │ HTTPS                     │               │
       Meta Graph API · Mercado Pago ·          │               │
       Anthropic (e os webhooks de volta)       │               │
                        ┌───────────────────────┘               │
                        │ SQL (Drizzle ORM)             LISTEN/NOTIFY
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
| Notifications | Aviso sonoro, lista de pedidos novos, aviso de cliente aguardando atendimento | 1–2 | ✅ |
| WhatsApp | Cloud API oficial: conexão por loja, webhooks, envio, avisos automáticos de pedido | 2 | ✅ |
| AI Assistant | Atendente virtual com ferramentas sobre o cardápio e os pedidos | 2 | ✅ |
| Inbox | Central de conversas (lista, chat, notas, transferências, ficha do cliente) | 2 | ✅ |
| Kitchen | Painel de produção para telas grandes/tablets | 2 | ✅ |
| Delivery | Bairros e taxas, entregadores, painel de entregas | 2 | ✅ |
| Payments | PIX online pelo Mercado Pago, webhooks, vencimento, estorno | 2 | ✅ (outros gateways: mesma interface) |
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

## 4. Modelo de dados

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

Tabelas da Fase 2 (`apps/api/drizzle/0001_fase2.sql`):

| Tabela | Observações |
|---|---|
| `delivery_zones` | bairro/região por unidade, nome único (sem diferenciar maiúsculas), taxa, mínimo e tempo próprios |
| `couriers` | entregadores da unidade, situação (disponível, em entrega, fora), vínculo opcional a um usuário |
| `deliveries` | uma por pedido de entrega: bairro, entregador, situação, horários de atribuição/saída/entrega, ocorrência |
| `integrations` | uma por provedor e empresa; `config` visível ao painel e `secrets` cifrados (AES-256-GCM); número da WhatsApp único entre empresas |
| `conversations` | contato × canal por empresa, modo IA/equipe, responsável, não lidas, última mensagem do cliente (janela de 24 h), rascunho do pedido da IA |
| `messages` | entrada, saída e notas internas; id da Meta único (reenvios não duplicam); situação enviada/entregue/lida/falhou com o erro |
| `quick_replies` | respostas rápidas da equipe |
| `ai_settings` · `ai_usage` | configuração da assistente por empresa; consumo por resposta (tokens, cache, modelo) |
| `payments` | cobrança no provedor por pedido: valor, situação, QR Code, vencimento, aprovação, estorno, resposta bruta |
| `webhook_events` | todo webhook recebido, com assinatura válida ou não, e quando foi processado |
| `jobs` | fila de tarefas no próprio PostgreSQL (ver seção 8) |

`customers` ganhou `tags`, e `order_events` ganhou `courier_assigned`, `delivery_problem` e
`payment_updated`.

Previstas para as próximas fases: `product_variations` (hoje tamanhos são grupos de adicionais de
escolha única), `coupons`, `campaigns`, `loyalty_accounts`, `loyalty_transactions`,
`inventory_items`, `inventory_movements`, `recipes`, `suppliers`, `expenses`, `cash_registers`,
`cash_movements`, `notifications`, `subscriptions`/`plans`.
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
   Pedidos lançados pela equipe já entram confirmados. Pedidos com PIX online começam em
   `awaiting_confirmation` (aguardando pagamento) e não aparecem para a cozinha nem para as entregas.
6. Entrega: se a unidade tem bairros cadastrados, o bairro é obrigatório no cardápio e define taxa,
   pedido mínimo e tempo; um bairro fora da lista é recusado. A linha de `deliveries` nasce junto.
7. Ainda na transação, a tarefa do aviso automático ao cliente entra na fila.

### Status

```
awaiting_confirmation ─(PIX aprovado pelo provedor)─> new ou confirmed      (PIX online)
new ─> confirmed ─> preparing ─> ready ─┬─> out_for_delivery ─> completed   (entrega)
                                        └─> completed                       (retirada/local)
qualquer etapa ativa ─> canceled (com motivo; devolve o estoque reservado e cancela PIX pendente)
```

Só o sistema tira um pedido de `awaiting_confirmation` (pagamento aprovado, recusado ou vencido);
a equipe pode cancelá-lo.

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

### Comunicação com o cliente

- **Com o WhatsApp oficial conectado**, cada mudança de etapa habilitada em Integrações gera a
  tarefa `notify_order_status`. Ao rodar, ela confere se o pedido ainda está naquela etapa (avisos
  atrasados não saem), monta o texto com os modelos de mensagem da loja e envia pela Cloud API.
  Dentro da janela de 24 h vai como texto; fora dela, só com um **modelo aprovado na Meta**
  configurado para a etapa. Sem modelo, nada é enviado e o histórico do pedido registra “não
  enviado” com o motivo. Erros da Meta também ficam no histórico.
- **Sem integração**, o botão **Avisar no WhatsApp** abre o WhatsApp da equipe com a mensagem pronta
  (link `wa.me`) e o histórico registra “mensagem aberta para envio”, não “enviada”.
- A situação de cada mensagem (enviada, entregue, lida, falhou) vem só do webhook de status da Meta
  e nunca regride (um “entregue” atrasado não desfaz um “lida”).

### Pagamento

- Formas presenciais (PIX com chave, dinheiro, cartões, vale-refeição): a chave PIX da loja aparece
  para o cliente e **a equipe só marca como recebido depois de conferir no banco**.
- **PIX online (Mercado Pago)**: ao criar o pedido, a API cria a cobrança com
  `X-Idempotency-Key = pix-{pedido}` (reenvios não geram outra) e mostra QR Code e copia e cola no
  acompanhamento, com 30 minutos de prazo.
- `syncPayment` é **o único caminho** para um pagamento online ficar pago: consulta o pagamento
  direto no Mercado Pago e confere a referência do pedido e o valor. É chamado pelo webhook (com
  assinatura `x-signature` conferida) e pela tarefa `payment_sync`, que roda no máximo a cada 10 s
  enquanto o cliente está na tela do PIX (funciona mesmo sem webhook configurado). O corpo do
  webhook nunca é usado como prova. Comprovante enviado pelo cliente não muda nada.
- Aprovado com o valor certo: o pedido vai para `new` (ou `confirmed`, com confirmação automática).
  Recusado, cancelado ou vencido (tarefa `payment_expiry`): a cobrança é cancelada no provedor e o
  pedido é cancelado com o motivo. Se a loja cancela o pedido antes, a cobrança pendente é
  cancelada na hora; se o cliente pagou mesmo assim, o painel mostra o aviso para estornar.
- A equipe não consegue marcar pagamento online como pago ou pendente manualmente (a API recusa).
  O estorno é pedido ao Mercado Pago, e o resultado oficial vem da consulta.

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
| Credenciais de integração | tokens da Meta e do Mercado Pago cifrados com AES-256-GCM (`ENCRYPTION_KEY`), conferidos no provedor antes de salvar, nunca devolvidos ao painel; só o fim do token aparece no registro de atividades |
| Webhooks | sem sessão nem CSRF, autenticados pela assinatura do provedor sobre o corpo bruto (`X-Hub-Signature-256` da Meta, `x-signature` do Mercado Pago); todo evento é gravado com o resultado da verificação |
| Dados de pagamento | a plataforma não recebe dados de cartão nem do banco do cliente; guarda só a referência e a situação da cobrança |
| Entregador | quem tem a função Entregador vê só as próprias entregas e o próprio cadastro |

---

## 8. Integrações

Padrão seguido por todas:

- Configuração por empresa em `integrations` (credenciais cifradas, nunca devolvidas ao front).
- Cliente HTTP isolado em `apps/api/src/integrations/<provedor>.ts`, com tempo limite e erro
  tipado (`ProviderError`, que diz se vale tentar de novo). O `fetch` é injetável: nos testes, a Meta,
  o Mercado Pago e a IA são substituídos por provedores falsos, sem chamar a internet.
- **Webhooks** em `/api/webhooks/<provedor>` com verificação de assinatura sobre o corpo bruto,
  gravação do evento em `webhook_events` e processamento idempotente.
- Estado da conexão visível no painel; token recusado pela Meta marca a integração como “com
  erro”, e o Atendimento deixa de oferecer resposta até a loja verificar ou trocar o token.

### Fila de tarefas

`services/jobs.ts`: fila sobre o próprio PostgreSQL (`SELECT … FOR UPDATE SKIP LOCKED`), sem Redis.
Funciona com várias instâncias da API. Cada tarefa tem `dedupe_key` única opcional (a mesma
tarefa não entra duas vezes), novas tentativas com espera crescente e `PermanentJobError` para
falhas que não adianta repetir. Tarefas: `notify_order_status`, `ai_reply`, `payment_sync`,
`payment_expiry`. Nos testes a fila não roda sozinha; cada teste executa as tarefas pendentes.

### WhatsApp Business Platform (Cloud API)

- A plataforma tem **um app na Meta** (`WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`) com o
  webhook `/api/webhooks/whatsapp`. Cada loja conecta o próprio número informando o identificador
  do número, o da conta WhatsApp Business e um token permanente; a API confere o número na Graph
  API e assina o app na conta da loja (`subscribed_apps`). O fluxo de Embedded Signup (login da
  Meta dentro do painel) é uma evolução possível sobre a mesma tabela.
- Mensagens recebidas são roteadas pela `phone_number_id`, gravadas uma única vez (id da Meta
  único) e criam/atualizam cliente e conversa. O número do cliente é normalizado (o `wa_id` de
  celulares brasileiros pode vir sem o 9).
- Envio sempre pela Graph API oficial (`/messages`): texto e imagem dentro da janela de 24 h,
  modelos aprovados fora dela. Nenhum método não oficial (WhatsApp Web, automação de aparelho).
- Mídias recebidas são baixadas sob demanda com o token da loja (as URLs da Meta são temporárias e
  protegidas) e servidas ao painel por `/api/inbox/messages/:id/media`.

### Assistente de IA

- Provedor: Anthropic, modelo `AI_MODEL` (padrão `claude-opus-5-5`), com fallback de servidor
  habilitado. Sem `ANTHROPIC_API_KEY`, a assistente aparece como indisponível e não pode ser ligada.
- Quando chega mensagem numa conversa com a IA, a tarefa `ai_reply` espera 1,5 s para juntar
  mensagens seguidas, monta o histórico e roda um laço de ferramentas de até 6 passos:
  `consultar_produto` (cardápio, preços e disponibilidade atuais), `montar_pedido` (preço calculado
  pelo mesmo `priceItem` e `quoteOrder` do cardápio), `registrar_pedido` (só registra o rascunho
  montado, pelo mesmo `createOrder`, com o id do rascunho como chave de idempotência),
  `consultar_pedidos` (pedidos do próprio cliente) e `transferir_para_humano`.
- O prompt fixo da plataforma proíbe inventar produto, preço ou desconto, exige confirmar o resumo
  antes de registrar e só permite dizer que o pedido foi feito depois que o sistema devolve o número.
  O prompt da loja (tom, regras, perguntas frequentes) vem depois e não pode mudar essas regras.
  A parte estável do prompt usa cache; dados que mudam (horário atual, loja aberta) vão no fim.
- Transferência para a equipe: por palavra-chave (antes de chamar a IA), pela ferramenta quando a
  IA decide (reclamação, problema de pagamento, pedido especial, pedido do cliente), por recusa do
  modelo, por erro do provedor ou quando ele segue fora do ar depois das novas tentativas. A conversa entra na fila e a equipe recebe aviso sonoro.
- O chat de teste do painel usa a IA de verdade com o cardápio atual, mas a ferramenta de registro
  nunca grava pedidos nesse modo.

### Outras

| Integração | Situação |
|---|---|
| E-mail transacional | Resend via HTTP (`services/mailer.ts`). Sem chave: em desenvolvimento a mensagem vai para o log; em produção o envio falha com erro claro e o convite mostra o link para copiar |
| Armazenamento | driver local (`services/storage.ts`). Interface pronta para um driver S3 compatível |
| Impressão | comanda otimizada para impressora térmica de 80 mm pelo navegador, no painel de pedidos e na cozinha; integração direta (ESC/POS) é uma evolução futura |

---

## 9. Roteiro das próximas fases

**Fase 2 · Operação e atendimento** ✅ entregue (cozinha, entregas, central de atendimento com
WhatsApp oficial, avisos automáticos, assistente de IA e PIX online). Evoluções naturais: Embedded
Signup da Meta, envio de documentos e áudio pela equipe, outros gateways (Stripe, Pagar.me) na
mesma interface de pagamento, rastreio do entregador.

**Fase 3 · Gestão comercial**: CRM com ficha única e segmentos, LGPD (exportar/corrigir/excluir),
cupons e promoções (aplicados dentro de `createOrder`), campanhas com opt-in/opt-out, cashback e
pontos com livro-razão de movimentações.

**Fase 4 · Gestão administrativa**: insumos e fichas técnicas com baixa em etapa configurável (um
único ponto de baixa por pedido, evitando consumo duplicado), financeiro, caixa e relatórios
exportáveis.

**Fase 5 · Plataforma SaaS**: superadministrador, planos e limites configuráveis sem código,
assinaturas e cobrança recorrente, múltiplas unidades com visão consolidada, RLS e monitoramento.

---

## 10. Limitações conhecidas

- Uma unidade por empresa na interface (o modelo e a API já trabalham por unidade).
- Taxa de entrega por bairro cadastrado; cálculo por distância ainda não existe.
- A equipe envia texto e imagem pelo Atendimento; documentos, áudio e localização são só recebidos.
- Imagens enviadas pela equipe precisam estar em um endereço público (`APP_URL`) para a Meta buscar.
- Pagamento online só pelo Mercado Pago (PIX); cartão online ainda não.
- Estoque por produto (quantidade simples). Insumos e fichas técnicas vêm na Fase 4.
- Ao editar os itens de um pedido, os preços são recalculados com o cardápio atual.
- Arquivos enviados ficam no disco do servidor; para várias instâncias, usar o driver S3.
- O limite de requisições guarda contadores na memória de cada instância; em escala, usar Redis.
