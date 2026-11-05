// Teste de ponta a ponta no navegador: cadastro → configuração → cardápio → pedido do cliente no
// celular → pedido chegando em tempo real no painel → confirmação → acompanhamento → pedido manual →
// dashboard → convite de atendente com acesso restrito.
//
// Requer API e web rodando (npm run dev) e o Playwright instalado:
//   BASE_URL=http://localhost:3000 node e2e/fluxo-completo.cjs
// As capturas de tela ficam em e2e/capturas/.
const { chromium, devices } = require('playwright');
const path = require('path');
const OUT = path.join(__dirname, 'capturas');
require('fs').mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const stamp = Date.now().toString(36);
const slug = `acai-da-praia-${stamp}`;

const shot = async (page, name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
  console.log('shot', name);
};

(async () => {
  const browser = await chromium.launch();
  const admin = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await admin.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

  // 1. Cadastro
  await page.goto(`${BASE}/cadastro`);
  await page.getByLabel('Nome da loja').fill('Açaí da Praia');
  await page.getByLabel('Endereço do cardápio').fill(slug);
  await page.getByLabel('Tipo de negócio').selectOption('acaiteria');
  await page.getByLabel('WhatsApp da loja').fill('11987654321');
  await page.getByLabel('Seu nome').fill('Camila Rocha');
  await page.getByLabel('E-mail').fill(`camila-${stamp}@exemplo.com`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByText('Li e aceito os').click();
  await shot(page, '01-cadastro');
  await page.getByRole('button', { name: 'Criar minha loja' }).click();
  await page.waitForURL('**/painel**');
  await page.getByText('Primeiros passos').waitFor();
  await shot(page, '02-dashboard-vazio');

  // 2. Horário: liga segunda pela interface e depois define todos os dias 00:00–23:59 pela API (mesma sessão)
  await page.goto(`${BASE}/painel/configuracoes`);
  await page.getByRole('button', { name: 'Horário' }).click();
  await shot(page, '03-config-horario');
  const res = await page.evaluate(async () => {
    const r = await fetch('/api/settings/hours', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-balcao-client': 'web' },
      body: JSON.stringify({ intervals: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: '00:00', closesAt: '23:59' })) }),
    });
    return r.status;
  });
  console.log('hours', res);

  // Pedidos/pagamento: ativa PIX com chave e taxa de entrega
  await page.reload();
  await page.getByRole('button', { name: 'Pedidos, entrega e pagamento' }).click();
  await page.getByLabel('Taxa de entrega').fill('6,00');
  await page.getByText('PIX', { exact: true }).click();
  await page.getByLabel('Chave PIX').fill('pix@acaidapraia.com.br');
  await page.getByLabel('Tipo de chave').selectOption('email');
  await shot(page, '04-config-pedidos');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await page.getByText('Regras de pedido salvas.').waitFor();

  // 3. Cardápio
  await page.goto(`${BASE}/painel/cardapio`);
  await page.getByRole('button', { name: 'Criar a primeira categoria' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Açaí no copo');
  await page.getByRole('dialog').getByRole('button', { name: 'Criar categoria' }).click();
  await page.getByText('Categoria criada.').waitFor();
  await page.getByRole('button', { name: 'Nova categoria' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Bebidas');
  await page.getByRole('dialog').getByRole('button', { name: 'Criar categoria' }).click();
  await page.getByText('Categoria criada.').first().waitFor();

  // Grupo: tamanho
  await page.getByRole('radio', { name: 'Adicionais' }).click();
  await page.getByRole('button', { name: 'Novo grupo' }).click();
  await page.locator('dialog[open]').getByLabel('Nome do grupo').fill('Escolha o tamanho');
  await page.locator('dialog[open]').getByLabel('Nome da opção').first().fill('300 ml');
  await page.locator('dialog[open]').getByRole('button', { name: 'Adicionar opção' }).click();
  await page.locator('dialog[open]').getByLabel('Nome da opção').nth(1).fill('500 ml');
  await page.locator('dialog[open]').getByLabel('Preço extra').nth(1).fill('6,00');
  await page.locator('dialog[open]').getByRole('button', { name: 'Adicionar opção' }).click();
  await page.locator('dialog[open]').getByLabel('Nome da opção').nth(2).fill('700 ml');
  await page.locator('dialog[open]').getByLabel('Preço extra').nth(2).fill('10,00');
  await shot(page, '05-grupo-editor');
  await page.getByRole('dialog').getByRole('button', { name: 'Criar grupo' }).click();
  await page.getByText(/Grupo “Escolha o tamanho” criado/).waitFor();

  // Grupo: adicionais pagos (opcional, até 4, Nutella até 2x)
  await page.getByRole('button', { name: 'Novo grupo' }).click();
  await page.locator('dialog[open]').getByLabel('Nome do grupo').fill('Turbine seu açaí');
  await page.getByRole('button', { name: /Opcional, várias/ }).click();
  await page.locator('dialog[open]').getByLabel('Nome da opção').first().fill('Nutella');
  await page.locator('dialog[open]').getByLabel('Preço extra').first().fill('4,50');
  await page.locator('dialog[open]').getByLabel('Quantidade máxima por opção').first().fill('2');
  await page.locator('dialog[open]').getByRole('button', { name: 'Adicionar opção' }).click();
  await page.locator('dialog[open]').getByLabel('Nome da opção').nth(1).fill('Granola');
  await page.locator('dialog[open]').getByRole('button', { name: 'Adicionar opção' }).click();
  await page.locator('dialog[open]').getByLabel('Nome da opção').nth(2).fill('Leite em pó');
  await page.locator('dialog[open]').getByLabel('Preço extra').nth(2).fill('2,00');
  await page.getByRole('dialog').getByRole('button', { name: 'Criar grupo' }).click();
  await page.getByText(/Grupo “Turbine seu açaí” criado/).waitFor();
  await shot(page, '06-grupos');

  // Produto
  await page.getByRole('radio', { name: /Produtos/ }).click();
  await page.getByRole('button', { name: 'Novo produto' }).click();
  await page.locator('dialog[open]').getByLabel('Nome', { exact: true }).fill('Açaí tradicional');
  await page.locator('dialog[open]').getByLabel('Preço', { exact: true }).fill('16,90');
  await page.locator('dialog[open]').getByLabel('Descrição').fill('Açaí cremoso batido na hora, com banana.');
  await page.locator('dialog[open]').getByText('Escolha o tamanho', { exact: true }).click();
  await page.locator('dialog[open]').getByText('Turbine seu açaí', { exact: true }).click();
  await page.locator('dialog[open]').getByText('Destaque', { exact: true }).click();
  await shot(page, '07-produto-editor');
  await page.getByRole('dialog').getByRole('button', { name: 'Adicionar produto' }).click();
  await page.getByText(/adicionado ao cardápio/).waitFor();

  await page.getByRole('button', { name: 'Novo produto' }).click();
  await page.locator('dialog[open]').getByLabel('Nome', { exact: true }).fill('Água de coco 300 ml');
  await page.locator('dialog[open]').getByLabel('Preço', { exact: true }).fill('7,00');
  await page.locator('dialog[open]').getByLabel('Categoria').selectOption({ label: 'Bebidas' });
  await page.locator('dialog[open]').getByText('Controlar quantidade', { exact: true }).click();
  await page.locator('dialog[open]').getByLabel('Quantidade em estoque').fill('10');
  await page.getByRole('dialog').getByRole('button', { name: 'Adicionar produto' }).click();
  await page.getByText(/adicionado ao cardápio/).first().waitFor();
  await page.waitForTimeout(600);
  await shot(page, '08-cardapio-admin');

  // Painel de pedidos aberto (vazio) esperando o pedido chegar em tempo real
  await page.goto(`${BASE}/painel/pedidos`);
  await page.getByText('Nenhum pedido em andamento').waitFor();

  // 4. Cliente no celular
  const phone = await browser.newContext({ ...devices['iPhone 13'] });
  const c = await phone.newPage();
  c.on('pageerror', (e) => errors.push(`cliente pageerror: ${e.message}`));
  c.on('console', (m) => m.type() === 'error' && errors.push(`cliente console: ${m.text()}`));
  await c.goto(`${BASE}/${slug}`);
  await c.getByRole('heading', { name: 'Açaí da Praia' }).waitFor();
  await c.screenshot({ path: path.join(OUT, '09-cardapio-cliente.png') });
  await c.getByRole('button', { name: /Açaí tradicional/ }).last().click();
  await c.getByRole('dialog').waitFor();
  await c.getByRole('button', { name: /Adicionar/ }).last().click(); // sem tamanho: deve mostrar erro
  await c.waitForTimeout(300);
  await c.screenshot({ path: path.join(OUT, '10-produto-erro-obrigatorio.png') });
  await c.getByRole('radio', { name: /500 ml/ }).click();
  await c.getByRole('button', { name: 'Adicionar', exact: true }).first().click(); // Nutella
  await c.getByRole('button', { name: 'Aumentar Nutella' }).click();
  await c.getByRole('checkbox', { name: /Granola/ }).click();
  await c.getByLabel(/observação/i).fill('Pouco gelo');
  await c.screenshot({ path: path.join(OUT, '11-produto-configurado.png') });
  await c.getByRole('button', { name: /^Adicionar\s*R\$/ }).click();
  await c.getByRole('button', { name: /Água de coco/ }).click();
  await c.getByRole('button', { name: /^Adicionar\s*R\$/ }).click();
  await c.getByRole('button', { name: /Ver sacola/ }).click();
  await c.waitForTimeout(400);
  await c.screenshot({ path: path.join(OUT, '12-sacola.png') });
  await c.getByRole('link', { name: /Continuar/ }).click();
  await c.waitForURL('**/finalizar');
  await c.getByRole('radio', { name: /Entrega/ }).click();
  await c.getByLabel('Rua').fill('Rua das Gaivotas');
  await c.getByLabel('Número').fill('120');
  await c.getByLabel('Bairro').fill('Gonzaga');
  await c.getByLabel('Cidade').fill('Santos');
  await c.getByLabel('Nome', { exact: true }).fill('Rafael Lima');
  await c.getByLabel('WhatsApp', { exact: true }).fill('13991234567');
  await c.getByRole('radio', { name: /PIX/ }).click();
  await c.screenshot({ path: path.join(OUT, '13-checkout.png'), fullPage: true });
  await c.getByRole('button', { name: /Fazer pedido/ }).click();
  await c.waitForURL('**/pedido/**');
  await c.getByText(/#1/).first().waitFor();
  await c.screenshot({ path: path.join(OUT, '14-acompanhamento-novo.png'), fullPage: true });

  // 5. Painel recebe em tempo real
  await page.getByText('Rafael Lima').filter({ visible: true }).first().waitFor({ timeout: 10000 });
  await shot(page, '15-quadro-novo-pedido');
  await page.getByRole('button', { name: /Abrir pedido 1 de Rafael Lima/ }).click();
  await page.getByRole('button', { name: 'Confirmar pedido' }).waitFor();
  await shot(page, '16-detalhe-pedido');
  await page.locator('dialog[open]').getByRole('button', { name: 'Confirmar pedido' }).click();
  await page.getByText(/Pedido #1: confirmado/).waitFor();
  await page.locator('dialog[open]').getByRole('button', { name: 'Iniciar preparo' }).click();
  await page.getByText(/Pedido #1: em preparação/).waitFor();
  await page.keyboard.press('Escape');
  await shot(page, '17-quadro-em-preparo');

  // Cliente vê atualização
  await c.reload();
  await c.getByText('Estamos preparando seu pedido').waitFor();
  await c.screenshot({ path: path.join(OUT, '18-acompanhamento-preparo.png'), fullPage: true });

  // 6. Pedido manual pelo painel
  await page.goto(`${BASE}/painel/pedidos/novo`);
  await page.getByRole('button', { name: /Água de coco/ }).click();
  await page.getByLabel('Nome do cliente').fill('Cliente balcão');
  await page.getByRole('button', { name: 'Lançar pedido', exact: true }).last().click();
  await page.getByText(/Pedido #2 lançado/).waitFor();
  await page.keyboard.press('Escape');

  // 7. Dashboard
  await page.goto(`${BASE}/painel`);
  await page.getByText('Faturamento').first().waitFor();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, '19-dashboard.png'), fullPage: true });

  // 8. Equipe
  await page.goto(`${BASE}/painel/equipe`);
  await page.getByRole('button', { name: 'Convidar pessoa' }).click();
  await page.locator('dialog[open]').getByLabel('Nome', { exact: true }).fill('Bruno Atendente');
  await page.locator('dialog[open]').getByLabel('E-mail').fill(`bruno-${stamp}@exemplo.com`);
  await page.locator('dialog[open]').getByText('Personalizar permissões').click();
  await shot(page, '20-convite');
  await page.getByRole('button', { name: 'Enviar convite' }).click();
  await page.getByText('Convite criado').waitFor();
  const inviteUrl = await page.locator('dialog[open]').getByLabel('Link do convite').inputValue();
  await shot(page, '21-convite-link');
  await page.getByRole('button', { name: 'Concluir' }).click();

  // Funcionário aceita e vê só o que pode
  const staffCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const s = await staffCtx.newPage();
  await s.goto(inviteUrl.replace(/^https?:\/\/[^/]+/, BASE));
  await s.getByLabel('Crie uma senha').fill('senha-do-bruno-1');
  await s.getByRole('button', { name: 'Aceitar convite' }).click();
  await s.waitForURL('**/painel/pedidos');
  await s.getByText('Rafael Lima').filter({ visible: true }).first().waitFor();
  await s.screenshot({ path: path.join(OUT, '22-atendente-pedidos.png') });

  // O Playwright injeta um estilo no cursor para as capturas, o que gera um aviso de hidratação inofensivo.
  const real = errors.filter((e) => !e.includes('caret-color'));
  console.log(real.length ? `ERROS NO NAVEGADOR:\n${real.join('\n')}` : 'Fluxo completo sem erros no navegador.');
  console.log('loja de teste:', `${BASE}/${slug}`);
  await browser.close();
  if (real.length) process.exit(1);
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
