# Central Scale & JP · Plano de Gravação

Módulo novo da Central (`modulos/plano-gravacao.html`). Ele mostra os Reels a postar numa janela de datas, separados por perfil (JP e Scale) e agrupados pelo cenário que precisa ser montado. No dia da gravação, a equipe monta um cenário, grava tudo dele em sequência e marca cada vídeo como gravado.

## O que tem nesta pasta (e o que não tem)

O código-fonte da Central não está neste repositório. Esta pasta foi montada a partir da versão publicada da Central em 10/11/2026 e tem **só código**:

| Arquivo | O que é |
|---|---|
| `modulos/plano-gravacao.html` | O módulo novo. Não tem roteiro nem data dentro dele: lê tudo de `dados/`. |
| `ferramentas/preparar-central.mjs` | Ferramenta que cria `dados/`, faz os três módulos lerem de lá e registra o módulo novo no `index.html`. |

Os roteiros, legendas e datas **não** foram copiados para cá, porque este repositório é público. A ferramenta gera a pasta `dados/` a partir dos arquivos da própria Central.

## Como instalar na Central

Na pasta raiz da Central (onde ficam `index.html` e `modulos/`):

1. Copie `modulos/plano-gravacao.html` para `modulos/` e `ferramentas/preparar-central.mjs` para `ferramentas/`.
2. Veja o que vai mudar, sem gravar nada:

   ```bash
   node ferramentas/preparar-central.mjs --verificar
   ```

3. Aplique:

   ```bash
   node ferramentas/preparar-central.mjs
   ```

4. Publique a pasta inteira, **incluindo `dados/`**.

A ferramenta pode rodar quantas vezes quiser. Se um módulo chegar de novo com os dados colados no HTML (uma versão nova com conteúdo atualizado), rode outra vez: os dados novos vão para `dados/` e o módulo volta a ler de lá.

## O que a ferramenta muda

- **Cria `dados/calendario.js`** com `LAUNCH`, `DEFAULTS` (horários), `ITEMS` e `PLANS` do Calendário de Posts.
- **Cria `dados/central-scale.js` e `dados/central-jp.js`** com o `DATA` de cada central.
- **Nos três módulos**, troca o bloco de dados por uma linha que lê de `dados/` e põe um `<script src="../dados/…">` antes do script. O resto do código não muda. Se o arquivo de dados não carregar, o módulo mostra um aviso em vez de abrir vazio.
- **No `index.html`**, adiciona o ícone `video` e o módulo no fim do `MODULES` (atalho Alt+8). Os atalhos dos outros módulos continuam iguais.

Os arquivos de `dados/` são JSON válido, com uma peça por linha. Dá para editar à mão, e o diff mostra só a peça que mudou.

Se `dados/` ainda não estiver publicada, o Plano de Gravação lê direto do HTML dos três módulos, como plano B.

## Como o módulo funciona

**Datas.** Vêm do Calendário de Posts, com o mesmo cálculo que ele faz. Se alguém descartar um Reel no Calendário, o próximo do mesmo tipo e funil entra no lugar, e o plano muda junto. Também valem os horários editados e a data de estreia escolhida. Esses ajustes ficam salvos no aparelho, como já acontece no Calendário.

**Só Reels.** Só entram as peças com `ITEMS[k].k === 'Reel'`.

**Janela.** Por padrão, as duas próximas semanas a partir da segunda-feira seguinte. As setas andam uma semana, os campos De e Até aceitam qualquer intervalo, e o seletor de semanas filtra a Semana 1 ou a Semana 2.

**Mesmo vídeo nos dois perfis.** Um vídeo do JP vira o mesmo do Scale quando:
- está no mapa `MESMO_VIDEO` do módulo, ou
- tem o mesmo título, sem acento e pontuação.

O mapa resolve casos como `R07j` = `RJ07`, em que o título muda. O selo roxo mostra as datas do outro perfil.

Quando o roteiro muda entre os perfis (em geral, a chamada final), o card avisa e mostra os dois trechos para gravar na mesma sessão. Nesses casos, o botão de copiar tem uma opção para cada perfil.

**Abas.**
- **Plano de gravação:** cada vídeo uma vez, com as datas dos dois perfis.
- **JP** e **Scale:** só os posts daquele perfil.

O "gravado" vale para o vídeo, então marcar numa aba marca nas outras.

**Setup de cada vídeo.** Vale o que vier primeiro nesta ordem:
1. A escolha feita no card, salva no aparelho.
2. A lista `SETUP_POR_ID` do módulo (classificação feita à mão para 16 a 29/11).
3. As regras automáticas, aplicadas à direção e ao `momento.cenario` do JP:

| Regra | Setup |
|---|---|
| Título "Black Friday #" | `blackfriday` |
| "Poltrona" ou "voz fora da câmera" | `poltrona` |
| "Tatame" ou "kimono", ou cenário `treino` | `tatame` |
| "Externo", "praia" ou "rua", ou cenário `praia` | `praia` |
| "Notebook", "gravação de tela" ou "Gravar a tela" | `notebook` |
| Título "Erro do Dono", "CLT do CNPJ", "Recado #", "POV: o cliente disse" ou "Dono que escala" | `serie` |
| "caderno", "quadro" ou "bloco de papel" | `caderno` |
| Qualquer outro | `flex` |

A regra de Black Friday vem antes da de caderno porque o título não deixa dúvida. Sem isso, o NV06 (que cita bloco de papel) cairia em caderno. Cada card explica o motivo do setup padrão.

**Datas divergentes.** Um aviso lista os Reels cujo campo `cal` na Central Scale ou na Central do JP não bate com o Calendário de Posts. Para 16 a 29/11 são 77 (44 do JP e 33 do Scale). O plano sempre usa o Calendário.

**Salvo no aparelho (localStorage):**
- `pg:gravado`: vídeos gravados
- `pg:setup`: setups trocados à mão

A aba e os filtros ficam só na sessão.

## Para as próximas semanas

Reels novos sem classificação à mão passam pelas regras automáticas. Se uma regra errar, troque o setup no card (fica salvo no aparelho). Para valer em todos os aparelhos, ponha o código em `SETUP_POR_ID`. Vídeos iguais com títulos diferentes entram em `MESMO_VIDEO`.

## Testes feitos (Chromium, 360 a 1280 px de largura)

- 16 a 29/11: 65 vídeos no Plano de gravação, 52 posts no JP e 34 no Scale.
- O "gravado" sincroniza entre as abas e continua depois de recarregar.
- Trocar o setup move o card e fica salvo. Voltar ao padrão limpa a escolha.
- "Copiar roteiro" copia o texto completo do `DATA`.
- Um descarte no Calendário muda o plano igual ao Calendário.
- Calendário de Posts, Central Scale e Central do JP, depois da ferramenta, mostram exatamente o mesmo texto que antes, sem erros.
- Sem `dados/`, o plano B (ler os módulos) dá os mesmos números.
- No `index.html`, o módulo aparece no menu e no dashboard, abre com Alt+8 e segue o tema claro ou escuro.
- Nenhuma rolagem lateral de 360 px para cima.

Falta o teste num celular de verdade.
