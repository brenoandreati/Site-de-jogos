# Stories dinâmicos: guia de edição automática

Este arquivo ensina o Claude a montar stories a partir de takes soltos, sem a pessoa precisar decidir corte por corte.

**Como usar:** coloque este arquivo na pasta dos vídeos (ou cole no chat) e peça:

> Lê o `stories-dinamicos.md` e edita os stories da pasta `<pasta>`.

O Claude faz tudo sozinho e só mostra o resultado no fim. Para ajustar, basta pedir em português simples, por exemplo: "tira o take do carro", "deixa mais curto", "troca a música", "começa pelo treino".

---

## Para o Claude: o que é o trabalho

Você recebe uma pasta com vários takes curtos gravados no iPhone. Exemplo: o JP chegando de carro na academia, saindo do carro, pegando a mochila, entrando, passando pela recepção e treinando. A maioria dos takes **não tem fala**. Seu trabalho é transformar isso em um story curto, com começo, meio e fim, pronto para postar.

Regras de trabalho:
- **Não pergunte nada durante a edição.** Decida com os padrões deste guia e entregue o vídeo pronto. Pergunte só se a pasta estiver vazia ou se os arquivos não abrirem.
- Fale com o JP em português do Brasil, simples e direto, sem termos técnicos. Não use travessão (o traço longo).
- **Nunca apague nem altere os arquivos originais.** Trabalhe em cópias, numa pasta `_edicao` dentro da pasta dos takes.
- No fim, entregue o vídeo, a lista dos takes usados na ordem e o que ficou de fora (e por quê).

## Ferramentas

- **ffmpeg** e **ffprobe**: cortar, juntar, cor, áudio e exportação.
- **Python 3** com `faster-whisper` (modelo `medium`, `compute_type=int8`): descobrir se o take tem fala e transcrever com o tempo de cada palavra.
- Se faltar alguma coisa, instale sozinho e avise em uma linha. No Windows: `winget install Gyan.FFmpeg` e `pip install faster-whisper`.

---

## Passo 1. Inventário dos takes

Para cada arquivo de vídeo da pasta (`.mov`, `.mp4`), leia com `ffprobe`:
- duração, resolução, fps e rotação (o iPhone grava "deitado" com uma marca de rotação; a imagem final tem que sair em pé);
- se é **HDR** (`color_transfer` = `arib-std-b67` ou `smpte2084`): precisa de conversão de cor, ver Passo 5;
- **hora da gravação**: `com.apple.quicktime.creationdate` (ou `creation_time`).

**Ordene os takes pela hora da gravação, não pelo nome.** A ordem em que as coisas aconteceram é o ponto de partida da história.

Descarte logo de cara:
- takes com menos de 1 segundo;
- takes de teste (câmera virada para o chão, apontando para o bolso, tela preta).

## Passo 2. Olhar cada take

Para entender o que acontece em cada take, **olhe as imagens**: tire 1 quadro por segundo (`ffmpeg -vf fps=1,scale=360:-2`), junte numa folha de miniaturas (`tile=6x4`) e analise.

Anote para cada take:
- **o que acontece**: chegada, saindo do carro, pegando as coisas, entrando, ambiente, treino, detalhe (mão, tênis, peso, rosto), olhar para a câmera;
- **o tipo de plano**: aberto (lugar inteiro), médio (corpo) ou detalhe (mão, objeto, rosto bem de perto);
- **o melhor trecho**: o momento com ação e câmera firme;
- **problemas**: câmera tremida demais, desfocado, escuro, alguém tampando, dedo na lente.

Descobrir trecho tremido sem depender só do olho: compare quadros seguidos (`select='gt(scene,0.3)'` ou a diferença média entre quadros). Movimento muito brusco fora da ação é tremida, evite.

Para saber se o take tem fala, transcreva o áudio com o `faster-whisper` (`word_timestamps=True`, `vad_filter=True`). Fala de bastidor ("pode ir", "grava aí", "de novo", risada, palavrão, "pera aí") **não é fala do story**: corte fora.

## Passo 3. Montar a história

Todo story segue esta estrutura, mesmo sem fala:

| Parte | O que mostrar | Duração |
|---|---|---|
| **Gancho** | O take mais forte visualmente: ação no meio (um levantamento de peso, a porta abrindo, o olhar para a câmera). Pode ser um trecho do fim da história, adiantado. | 1 a 2 s |
| **Contexto** | Onde ele está e o que vai fazer: chegada, carro, fachada. | 3 a 6 s |
| **Caminho** | A sequência na ordem real: sai do carro, pega as coisas, entra, passa pela recepção. | 4 a 8 s |
| **Ápice** | O momento principal: o treino, o trabalho, a reunião. Os melhores takes de ação. | 5 a 10 s |
| **Fechamento** | Um final que respira: olhar para a câmera, detalhe, saída, sorriso, ou uma fala curta se tiver. | 2 a 4 s |

**Duração total:** de 15 a 30 segundos. Se o material for bom e variado, até 45 s. Story passa de 60 s? Divida em partes de no máximo 60 s, cada uma terminando num momento que pede o próximo.

**Ritmo e cortes:**
- Cada take fica de **1 a 3 segundos** nos trechos dinâmicos. O ápice pode ter takes de até 4 s.
- **Corte no movimento**: corte quando ele está se mexendo (abrindo a porta, dando o passo), e o próximo take começa já com movimento. Fica fluido.
- **Varie os planos**: não coloque dois planos abertos iguais seguidos. Alterne aberto, médio e detalhe.
- **Nunca junte dois takes quase iguais** (mesmo enquadramento, mesma ação): parece erro. Fique só com o melhor.
- Tire o começo e o fim de todo take: os primeiros 0,3 a 0,5 s (dedo apertando o botão) e o final (câmera abaixando).
- Use só **corte seco** entre os takes. Nada de efeito de transição (estrela, giro, cubo). No fechamento, pode terminar com um fade para preto de 0,3 s.
- Velocidade (opcional, só onde ajuda): caminhada longa pode ir em 1,5x. Take gravado em 60 fps pode virar câmera lenta 2x no ápice (`setpts=2*PTS`, saída em 30 fps).

## Passo 4. Takes com fala

Quando um take tem o JP falando para a câmera (comentário, dica, convite):
- A fala manda: use a frase inteira, do começo ao fim, sem cortar palavra. Corte só as pausas longas e os tropeços ("éé", palavra repetida, frase recomeçada).
- Takes sem fala entram **antes** (contexto) e **depois** (fechamento) da fala, ou por cima do áudio dela, se a fala for longa (a voz continua e a imagem mostra o que ele está falando).
- **Legenda obrigatória** em toda fala:
  - texto branco, fonte grossa (Montserrat ExtraBold ou parecida), contorno preto ou sombra para ler em qualquer fundo;
  - frases curtas: no máximo 2 linhas e uns 32 caracteres por linha, trocando junto com a fala (use o tempo de cada palavra da transcrição);
  - posição: por volta de 65% a 72% da altura da tela, centralizada;
  - corrija a transcrição: nomes certos (JP, Scale Business), números como ele falou, sem palavrão.
- Gere a legenda como arquivo `.ass` e grave no vídeo com o filtro `subtitles` do ffmpeg.

## Passo 5. Imagem

- **Saída: 1080 x 1920, 30 fps, em pé.** Take horizontal: corte o centro para ficar em pé (ou coloque desfocado atrás, se cortar perder a ação).
- **iPhone em HDR fica lavado ou estourado em outros aparelhos.** Converta para cor normal (SDR):
  ```
  zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p
  ```
  (precisa de um ffmpeg com `zimg`; a versão do `winget` já tem).
- Deixe a cor parecida entre os takes: se um estiver bem mais escuro, clareie um pouco (`eq=brightness=0.04:saturation=1.05`). Nada de filtro forte.
- **Área segura do story**: não coloque texto nem nada importante nos 250 px de cima e nos 340 px de baixo (o Instagram cobre com o nome do perfil e a caixa de resposta).

## Passo 6. Som

- **Sem fala:** use uma trilha suave de fundo e deixe o som ambiente bem baixo (porta, passos, peso batendo dão vida: uns 20% do volume original).
- **Com fala:** a voz fica clara e a trilha bem baixa por baixo. Abaixe a trilha automaticamente quando ele fala (`sidechaincompress`, ou volume da trilha uns 18 dB abaixo da voz).
- Trilha com fade de entrada (0,5 s) e de saída (1 s). Se a trilha tiver uma batida marcada, tente fazer os cortes caírem na batida.
- Volume final do vídeo: por volta de -14 LUFS (`loudnorm=I=-14:TP=-1.5:LRA=11`).
- **De onde vem a trilha:** use só as músicas da pasta `trilhas` que o JP indicar (músicas livres de direitos). Se não houver pasta de trilhas, exporte **duas versões**: uma com o som ambiente e uma sem trilha, para ele colocar música direto no Instagram (o próprio app oferece músicas liberadas para stories).

## Passo 7. Exportar e conferir

Exporte em MP4: H.264 (`libx264`, `crf 18`, `preset medium`, `yuv420p`), áudio AAC 192 kbps, `-movflags +faststart`.

Antes de entregar, confira sozinho:
- a duração bate com o planejado e não há quadro preto no meio (`blackdetect`);
- a imagem está em pé e não está esticada;
- se tem fala: transcreva o vídeo final e compare com a fala original. Não pode faltar palavra no começo nem no fim de nenhuma frase;
- tire uma folha de miniaturas do vídeo final (1 quadro a cada 1,5 s) e olhe: a história faz sentido nessa ordem? Tem algum take repetido? Algum texto está em cima do rosto?

Arrume o que estiver errado antes de mostrar.

## Passo 8. Entregar

Salve em `_edicao/` com nome claro, por exemplo `story-academia-2026-11-20.mp4`. Responda ao JP com:
1. o vídeo;
2. a ordem dos takes, uma linha por take (`IMG_1234: saindo do carro, 2,1 s`);
3. o que ficou de fora e o motivo (tremido, repetido, escuro);
4. uma frase sugerindo o que dá para mudar, se ele quiser.

Quando ele pedir mudança ("troca o take 3", "mais rápido", "sem música"), refaça só aquilo e mantenha o resto igual.

---

## Padrões (use sempre, sem perguntar)

| Item | Padrão |
|---|---|
| Formato | 1080 x 1920, 30 fps, MP4 H.264 |
| Duração | 15 a 30 s (até 60 s por story) |
| Cada take | 1 a 3 s (ápice até 4 s) |
| Transição | corte seco; fade para preto de 0,3 s só no final |
| Cor | HDR convertido para SDR, ajuste leve entre takes |
| Som sem fala | trilha suave + som ambiente a 20% |
| Som com fala | voz clara, trilha bem baixa por baixo |
| Legenda | só quando há fala; branca, grossa, contorno; 65% a 72% da altura |
| Volume final | -14 LUFS |
| Fala de bastidor | sempre cortada |
| Originais | nunca alterados |
