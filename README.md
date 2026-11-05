# Site Breno Andreati: landing page grátis

Página de captação: oferece uma landing page grátis e envia o pedido direto para o WhatsApp.
É um site estático (HTML, CSS e JS puros), sem build.

## Antes de publicar

1. **WhatsApp e Instagram**: edite o bloco `CONFIG` no começo de `assets/main.js`.
   - `whatsapp`: DDI + DDD + número, só dígitos (ex.: `5511912345678`).
   - `instagram`: seu @ sem a arroba.
   - `vagasPorMes`: quantas páginas você abre por mês (use `0` para esconder o número).
2. **Textos**: a copy está toda em `index.html`. Revise principalmente “Por que de graça” e as dúvidas.

## Identidade

- Cores tiradas da logo: fundo `#02081C`, branco `#F1F2F6`, azul `#0040FF` (sombra `#001CA6`).
- Logo em vetor: `assets/logo.svg`; ícone da aba: `assets/favicon.svg`.
- Fontes: Archivo (títulos em caixa-alta e texto) e Newsreader itálico (destaques em azul).

## Ver no computador

```bash
npx http-server -p 8080
```

Depois abra http://localhost:8080.

## Publicar no GitHub Pages

Em *Settings → Pages*, escolha a branch e a pasta `/ (root)`.

---

## Balcão — plataforma de pedidos e gestão para alimentação

A pasta [`balcao/`](balcao/) contém uma aplicação separada da landing page: a plataforma SaaS
**Balcão** (cardápio digital, pedidos em tempo real, equipe e gestão para açaiterias,
hamburguerias, pizzarias e restaurantes). Instruções em [`balcao/README.md`](balcao/README.md) e
arquitetura em [`balcao/docs/ARCHITECTURE.md`](balcao/docs/ARCHITECTURE.md).
