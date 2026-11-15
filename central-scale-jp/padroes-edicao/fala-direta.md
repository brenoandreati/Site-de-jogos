# Padrão fala direta (v1, 15/11/2026)

Para Reels em que o JP fala direto para a câmera, sem perguntas: dicas, IA na prática, séries (Erro de gestão), conteúdo de fundo de funil com CTA. Mesmas cores, fonte e movimentos do padrão pergunta e resposta (v2): navy #16294A, off-white #F4F1EA, dourado #E0B84F, Montserrat 700/800.

## O que entra na tela

- **Abertura:** rótulo dourado (série ou tema, ex.: IA NA PRÁTICA, ERRO DE GESTÃO #11) e o título grande, com a mesma entrada de máscara. Sai quando termina o gancho.
- **Legenda em frases curtas** (até 2 linhas, embaixo, em 70% da altura), quebrada no ponto e na vírgula. Palavras-chave em dourado. Sem palavra por palavra.
- **Um cartão por vez** no topo, só quando ele soma ao que é falado:
  - **lista**: itens com bolinha dourada, entram no momento em que são falados; pode ter título e um rodapé sublinhado (ex.: "Toda segunda-feira");
  - **passos**: mesmo cartão, com número dourado em cada item e uma linha de apoio menor;
  - **prompt**: o texto que ele manda falar pra IA vai sendo digitado enquanto ele fala, com cursor dourado;
  - **cta**: palavra para comentar em destaque dourado (PROPOSTA, TREINO), "Salve este vídeo" ou o produto (Scale Business · Aula 3), com um selo "Link na bio".
- **Tela dividida (série IA na prática)**: quando ele explica como fazer, a metade de cima vira uma conversa com a IA (exemplo fictício): a pergunta é digitada no ritmo da fala e a resposta aparece linha por linha quando ele cita cada parte. O JP desce para a metade de baixo, inteiro (recorte de 480 a 1440 da altura), e a legenda fica mais baixa. Monta com `montar_split.py nome saida.mp4 480`. Exemplo: `exemplo-fala-tela-dividida.json`.
- Enquanto um cartão de lista, passos ou prompt mostra o que ele está falando, a legenda some (não repete a informação).
- Zoom alternando 100% e 108% a cada parte do vídeo, com aproximação lenta, a mesma cor e o mesmo tick baixo quando cada item aparece.

## Como fazer

1. Transcrever o vídeo cortado com tempo por palavra.
2. Escrever as marcas (`ferramentas/exemplo-fala-*.json`): título, palavras onde troca o zoom (`blocos`), cartões com a palavra onde entram (`de`) e saem (`ate`), destaques, correções da transcrição (`trocas` por palavra, `trocas_texto` por trecho).
3. `python3 plano_fala.py marcas.json transcricao.json duração cortes.json eventos.json`
4. `python3 base.py cortes.json video.mp4 base.mov`, `node quadros.js overlay_fala.html eventos.json quadros/`, `python3 montar.py nome saida.mp4`.

## Finalização Scale (todos os vídeos, desde 15/11/2026)

Todo vídeo termina com 2,2 s da logo da Scale: SCALE em azul brilhante com a flecha subindo no A, desenhada em alta (a imagem original tem 150 px), sobre fundo azul-marinho com luz dourada e uma linha dourada embaixo. Entra com transição suave de 0,35 s e um som baixo.

1. `node outro_quadros.js quadros_outro 2.2` desenha os quadros de `outro.html` (uma vez só).
2. Junta com o som em `outro_scale.mov` (ver o comando no histórico da edição).
3. `python3 aplicar_final.py video.mp4 saida.mp4 outro_scale.mov` em cada vídeo.

Cartão `"compacto": true`: letras menores, para quando o JP está enquadrado mais alto e o cartão cobriria o rosto.

## Cartão longe do rosto

Antes de entregar, `python3 rosto.py nome [nome...]` (precisa de `opencv-python-headless` 4.x) mede, a cada 0,5 s, se algum cartão fica na frente do rosto (da testa ao queixo). Onde fica:
- `"compacto": true` quando o cartão só encosta na cabeça;
- `"baixo": true` (no cartão, ou na pergunta do Isso ou aquilo) desce o cartão para a parte de baixo e a legenda vai logo abaixo dele;
- se o JP se mexe muito no trecho, divide o cartão em dois (um em cima, outro embaixo), trocando no momento em que o rosto muda de altura.
