#!/usr/bin/env node
/* =====================================================================
   Central Scale & JP · preparar-central.mjs

   Uso (na pasta raiz da Central, onde ficam index.html e modulos/):
     node ferramentas/preparar-central.mjs            aplica as mudanças
     node ferramentas/preparar-central.mjs --verificar só mostra o que faria
     node ferramentas/preparar-central.mjs <pasta>    roda em outra pasta

   O que faz (cada passo pode rodar quantas vezes quiser):
   1. Tira do Calendário de Posts os dados que estavam colados no HTML
      (LAUNCH, DEFAULTS, ITEMS e PLANS) e grava em dados/calendario.js.
   2. Tira o DATA da Central Scale e da Central do JP e grava em
      dados/central-scale.js e dados/central-jp.js.
   3. Troca, em cada módulo, o bloco de dados por uma linha que lê do
      arquivo de dados/. O resto do código do módulo não muda.
   4. Registra o módulo Plano de Gravação no MODULES do index.html.

   Se um módulo chegar de novo com os dados colados no HTML (por exemplo,
   uma versão nova gerada com conteúdo atualizado), rode outra vez: os
   dados novos vão para dados/ e o módulo volta a ler de lá.
   ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const DRY = args.includes('--verificar');
const ROOT = path.resolve(args.find(a => !a.startsWith('--')) || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const rel = p => path.relative(ROOT, p) || '.';
const log = (...m) => console.log(...m);
let problems = 0;
const fail = msg => { problems++; console.error('  ✗ ' + msg); };

if (!fs.existsSync(path.join(ROOT, 'modulos'))) {
  console.error(`Não achei a pasta modulos/ em ${ROOT}. Rode na raiz da Central.`);
  process.exit(1);
}

/* ------------------------------------------------------------ utilidades */
function read(p) { return fs.readFileSync(p, 'utf8'); }
function write(p, s) {
  if (DRY) return;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s);
}

/* JSON com uma entrada por linha nos primeiros níveis: fica legível e o diff no git mostra só a peça que mudou. */
function pretty(v, levels, ind = '') {
  if (levels <= 0 || v === null || typeof v !== 'object') return JSON.stringify(v);
  const inner = ind + ' ';
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    return '[\n' + v.map(x => inner + pretty(x, levels - 1, inner)).join(',\n') + '\n' + ind + ']';
  }
  const ks = Object.keys(v);
  if (!ks.length) return '{}';
  return '{\n' + ks.map(k => inner + JSON.stringify(k) + ':' + pretty(v[k], levels - 1, inner)).join(',\n') + '\n' + ind + '}';
}

function dataFile(chave, cabecalho, valor) {
  return `/* Central Scale & JP · dados compartilhados (${chave})\n` +
    cabecalho.map(l => '   ' + l).join('\n') + '\n' +
    `   Gerado por ferramentas/preparar-central.mjs. Pode editar à mão: é JSON válido. */\n` +
    `(window.CENTRAL_DADOS=window.CENTRAL_DADOS||{})[${JSON.stringify(chave)}]=${valor};\n`;
}

/* Lê um arquivo de dados/ do jeito que o navegador leria. */
function loadDataFile(p, chave) {
  const ctx = { window: {} };
  vm.runInNewContext(read(p), ctx, { filename: p });
  return ctx.window.CENTRAL_DADOS && ctx.window.CENTRAL_DADOS[chave];
}

/* Acha a linha "const NOME=<json>;" e devolve {start,end,value}. */
function findJsonLine(src, nome) {
  const re = new RegExp('^const ' + nome + '=(.*);[ \\t]*$', 'm');
  const m = re.exec(src);
  if (!m) return null;
  const json = m[1];
  if (!/^[\[{]/.test(json)) return null; // já aponta para dados/
  return { start: m.index, end: m.index + m[0].length, value: JSON.parse(json) };
}

/* Acha o bloco "const NOME={ ... };" de várias linhas (objeto JS, não JSON). */
function findJsBlock(src, nome) {
  const head = new RegExp('^const ' + nome + '=\\{[ \\t]*$', 'm').exec(src);
  if (!head) return null;
  const close = /^\};[ \t]*$/m;
  const rest = src.slice(head.index);
  const c = close.exec(rest);
  if (!c) return null;
  const literal = rest.slice(('const ' + nome + '=').length, c.index + 1);
  const value = vm.runInNewContext('(' + literal + ')', {});
  return { start: head.index, end: head.index + c.index + c[0].length, value };
}

/* Aplica trocas [start,end,texto] de trás para frente. No mesmo ponto,
   a troca que substitui texto vem antes da que só insere. */
function splice(src, edits) {
  edits.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  for (const [s, e, t] of edits) src = src.slice(0, s) + t + src.slice(e);
  return src;
}

/* Insere <script src> logo antes do <script> que contém a posição pos. */
function scriptTagBefore(src, pos, file) {
  const at = src.lastIndexOf('<script>', pos);
  if (at < 0) throw new Error('não achei o <script> do bloco de dados');
  return [at, at, `<script src="../dados/${file}"></script>\n`];
}

const avisoSemDados = (arquivo) =>
  `if(!DATA.length)document.addEventListener('DOMContentLoaded',function(){var d=document.createElement('div');d.setAttribute('role','alert');d.style.cssText='position:sticky;top:0;z-index:99;background:#FFF4D6;color:#5A4306;padding:10px 14px;font:14px system-ui,sans-serif';d.textContent='Não carregou dados/${arquivo}. Recarregue a página; se continuar, confira se a pasta dados/ foi publicada.';document.body.prepend(d);});`;

/* ------------------------------------------------- 1. Calendário de Posts */
function calendario() {
  const file = path.join(ROOT, 'modulos/calendario-posts.html');
  const out = path.join(ROOT, 'dados/calendario.js');
  log(`\n• ${rel(file)}`);
  if (!fs.existsSync(file)) return fail('arquivo não encontrado');
  let src = read(file);
  const items = findJsonLine(src, 'ITEMS');
  if (!items) {
    if (src.includes('CENTRAL_DADOS')) log('  ✓ já lê de dados/calendario.js');
    else fail('não achei "const ITEMS={...};" nem a leitura de dados/');
    return;
  }
  const plans = findJsonLine(src, 'PLANS');
  const defs = findJsBlock(src, 'DEFAULTS');
  const launch = /^let LAUNCH='(\d{4}-\d{2}-\d{2})';[ \t]*$/m.exec(src);
  const plan = /^let PLAN=PLANS\['\d{4}-\d{2}-\d{2}'\];[ \t]*$/m.exec(src);
  const iife = /<script>\s*\n\(function\(\)\{[ \t]*\n/.exec(src);
  if (!plans || !defs || !launch || !plan || !iife) {
    return fail('formato inesperado (faltou ' + [!plans && 'PLANS', !defs && 'DEFAULTS', !launch && 'LAUNCH', !plan && 'PLAN', !iife && 'início do script'].filter(Boolean).join(', ') + '). Nada foi alterado.');
  }
  const dados = { LAUNCH: launch[1], DEFAULTS: defs.value, ITEMS: items.value, PLANS: plans.value };
  const body = '{\n' +
    '"LAUNCH":' + JSON.stringify(dados.LAUNCH) + ',\n' +
    '"DEFAULTS":' + pretty(dados.DEFAULTS, 2) + ',\n' +
    '"ITEMS":' + pretty(dados.ITEMS, 1) + ',\n' +
    '"PLANS":' + pretty(dados.PLANS, 3) + '\n}';
  const guard = `const DADOS=(window.CENTRAL_DADOS||{}).calendario;\n` +
    `if(!DADOS){document.getElementById('app').innerHTML='<div class="banner">Não carregou dados/calendario.js. Recarregue a página; se continuar, confira se a pasta dados/ foi publicada.</div>';return;}\n`;
  const iifeEnd = iife.index + iife[0].length;
  src = splice(src, [
    [iifeEnd, iifeEnd, guard],
    [launch.index, launch.index + launch[0].length, 'let LAUNCH=DADOS.LAUNCH;'],
    [defs.start, defs.end, 'const DEFAULTS=DADOS.DEFAULTS;'],
    [items.start, items.end, 'const ITEMS=DADOS.ITEMS;'],
    [plans.start, plans.end, 'const PLANS=DADOS.PLANS;'],
    [plan.index, plan.index + plan[0].length, 'if(!PLANS[LAUNCH])LAUNCH=Object.keys(PLANS).sort()[0];\nlet PLAN=PLANS[LAUNCH];'],
    [iife.index, iife.index, '<script src="../dados/calendario.js"></script>\n'],
  ]);
  write(out, dataFile('calendario', [
    'Fonte única das datas e horários de postagem (Calendário de Posts).',
    'Lido por: modulos/calendario-posts.html e modulos/plano-gravacao.html.',
    'LAUNCH: primeiro dia de postagem · DEFAULTS: horários de cada perfil',
    'ITEMS: peças ("s:ID" Scale, "j:ID" JP) · PLANS[LAUNCH][perfil][data].s: peça de cada horário.',
  ], body));
  write(file, src);
  log(`  ✓ ${Object.keys(dados.ITEMS).length} peças, ${Object.keys(dados.PLANS).length} plano(s), estreia ${dados.LAUNCH} → ${rel(out)}`);
  if (!DRY) check(out, 'calendario', dados);
}

/* ------------------------------------------- 2. Central Scale / Central JP */
function central(modulo, chave, arquivo) {
  const file = path.join(ROOT, 'modulos', modulo);
  const out = path.join(ROOT, 'dados', arquivo);
  log(`\n• ${rel(file)}`);
  if (!fs.existsSync(file)) return fail('arquivo não encontrado');
  let src = read(file);
  const data = findJsonLine(src, 'DATA');
  if (!data) {
    if (src.includes('CENTRAL_DADOS')) log(`  ✓ já lê de dados/${arquivo}`);
    else fail('não achei "const DATA=[...];" nem a leitura de dados/');
    return;
  }
  src = splice(src, [
    [data.start, data.end, `const DATA=(window.CENTRAL_DADOS||{})[${JSON.stringify(chave)}]||[];\n` + avisoSemDados(arquivo)],
    scriptTagBefore(src, data.start, arquivo),
  ]);
  write(out, dataFile(chave, [
    `Fonte única das peças da ${chave === 'jp' ? 'Central do JP' : 'Central Scale'} (DATA): títulos, ganchos, roteiros, direção e legendas.`,
    `Lido por: modulos/${modulo} e modulos/plano-gravacao.html.`,
  ], pretty(data.value, 1)));
  write(file, src);
  log(`  ✓ ${data.value.length} peças → ${rel(out)}`);
  if (!DRY) check(out, chave, data.value);
}

function check(out, chave, esperado) {
  const lido = loadDataFile(out, chave);
  if (JSON.stringify(lido) !== JSON.stringify(esperado)) fail(`${rel(out)} não bate com o original. Confira antes de publicar.`);
}

/* ------------------------------------------ 3. Registrar no index.html */
const ICON_VIDEO = `  video:'<path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2"/>',`;
const MODULO = `,
  { id:'plano-gravacao', file:'modulos/plano-gravacao.html', name:'Plano de Gravação', short:'Gravação', brand:'both', brandLb:'Scale + JP', icon:'video',
    desc:'Reels a gravar nas próximas semanas, separados por perfil e agrupados pelo cenário: monta o cenário, grava tudo dele em sequência e marca o que já foi gravado.',
    feats:['Por cenário','Scale + JP','Marcar gravado'] }`;

function shell() {
  const file = path.join(ROOT, 'index.html');
  log(`\n• ${rel(file)}`);
  if (!fs.existsSync(file)) return fail('arquivo não encontrado');
  if (!fs.existsSync(path.join(ROOT, 'modulos/plano-gravacao.html'))) fail('modulos/plano-gravacao.html não está na pasta: copie o arquivo antes de publicar.');
  let src = read(file);
  const edits = [];
  if (!/\bvideo:'/.test(src)) {
    const m = /^(\s*)home:'/m.exec(src);
    if (!m) return fail('não achei o mapa de ícones (home:...). Nada foi alterado.');
    edits.push([m.index, m.index, ICON_VIDEO + '\n']);
  }
  if (!/id:'plano-gravacao'/.test(src)) {
    const start = src.indexOf('var MODULES = [');
    const end = start < 0 ? -1 : src.indexOf('\n];', start);
    if (end < 0) return fail('não achei o fim do array MODULES. Nada foi alterado.');
    const lastBrace = src.lastIndexOf('}', end);
    edits.push([lastBrace + 1, lastBrace + 1, MODULO]);
  }
  if (!edits.length) { log('  ✓ Plano de Gravação já está no MODULES'); return; }
  src = splice(src, edits);
  write(file, src);
  const n = (src.slice(src.indexOf('var MODULES = ['), src.indexOf('\n];', src.indexOf('var MODULES = ['))).match(/\{ id:'/g) || []).length;
  log(`  ✓ registrado no MODULES (posição ${n}, atalho Alt+${n <= 9 ? n : '—'})`);
}

log(`Central em ${ROOT}${DRY ? '  (só verificando: nada será gravado)' : ''}`);
try {
  calendario();
  central('central-scale.html', 'scale', 'central-scale.js');
  central('central-jp.html', 'jp', 'central-jp.js');
  shell();
} catch (e) {
  fail(e.message);
}
log(problems ? `\n${problems} problema(s). Veja acima.` : `\nPronto.${DRY ? ' Rode sem --verificar para aplicar.' : ' Publique a pasta inteira, incluindo dados/.'}`);
process.exit(problems ? 1 : 0);
