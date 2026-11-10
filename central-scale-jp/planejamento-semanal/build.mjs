#!/usr/bin/env node
/* =====================================================================
   Planejamento Semanal · build.mjs
   Monta public/ para publicar no Cloudflare:
     public/index.html  o módulo Plano de Gravação (../modulos/plano-gravacao.html)
                        com o nome do sistema e o link para o mapa
     public/mapa.html   o Mapa de Gravação, se você passar --mapa <arquivo>
   Uso: node build.mjs --mapa caminho/mapa-gravacao.html
   ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(AQUI, 'public');
const args = process.argv.slice(2);
const mapaArg = args.includes('--mapa') ? args[args.indexOf('--mapa') + 1] : null;

function troca(src, de, para, nome) {
  if (!src.includes(de)) throw new Error(`não achei ${nome}: o módulo mudou? Ajuste build.mjs.`);
  return src.replace(de, para);
}

fs.mkdirSync(OUT, { recursive: true });

/* 1. sistema */
let html = fs.readFileSync(path.join(AQUI, '..', 'modulos', 'plano-gravacao.html'), 'utf8');
html = troca(html, '<title>Plano de Gravação</title>', '<title>Planejamento Semanal</title>', 'o <title>');
html = troca(html, '<p class="eyebrow">Plano de gravação</p>', '<p class="eyebrow">Planejamento semanal</p>', 'o eyebrow');
html = troca(html, "${origem==='modulos'?' Os dados foram lidos direto dos módulos porque a pasta dados/ ainda não foi publicada.':''}",
  ' Dados lidos ao vivo da Central Scale e JP.', 'o aviso de origem dos dados');
if (mapaArg) {
  html = troca(html, '<p class="intro" id="intro"></p>',
    '<p class="intro" id="intro"></p>\n  <a class="maplink" href="mapa">Mapa de 16 a 29/11: por que cada local, captações e sugestão de dias →</a>', 'o parágrafo de introdução');
  html = troca(html, '</style>', '.maplink{display:inline-block;margin-top:10px;font-size:13.5px;font-weight:600;color:var(--accent);text-decoration:underline;text-underline-offset:3px}\n</style>', 'o fim do <style>');
}
fs.writeFileSync(path.join(OUT, 'index.html'), html);

/* 2. mapa (página publicada no Claude: chega sem <html>/<head>, então ganha o documento completo) */
if (mapaArg) {
  const m = fs.readFileSync(mapaArg, 'utf8');
  const corte = m.indexOf('<header class="hd">');
  if (corte < 0) throw new Error('o arquivo do mapa não tem <header class="hd">');
  let corpo = m.slice(corte);
  corpo = troca(corpo, '<p class="eyebrow">', '<a class="back" href="./">← Planejamento semanal</a>\n      <p class="eyebrow">', 'o eyebrow do mapa');
  const doc = '<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' +
    '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}' +
    '.back{display:inline-block;margin-bottom:10px;color:var(--navy-muted);font-size:13px;font-weight:600;text-decoration:none}.back:hover{color:var(--on-navy)}</style>\n' +
    m.slice(0, corte).replace('<meta name="claude:viewport-fit-sides" content="cover">\n', '') +
    '</head>\n<body>\n' + corpo + '\n</body>\n</html>\n';
  fs.writeFileSync(path.join(OUT, 'mapa.html'), doc);
}
console.log('public/ pronto:', fs.readdirSync(OUT).join(', '));
