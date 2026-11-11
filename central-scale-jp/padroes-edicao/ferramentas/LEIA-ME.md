# Edição no padrão pergunta e resposta: ferramentas

Primeiro vídeo feito assim: R001x (Isso ou aquilo: MARKETING), em 11/11/2026.

1. Transcrever o bruto com tempo por palavra (faster-whisper, modelo medium, pt).
2. Escrever o plano do vídeo (`exemplo-r001x.json`). Ele define os trechos do bruto que entram: abertura, pergunta e resposta de cada item, legendas e CTA. Também define o texto das opções e qual foi escolhida.
3. `python3 cortes.py plano.json audio.wav cortes.json transcricao.json IMG_xxxx` monta os cortes sem comer palavra. Cada trecho vai do começo da primeira palavra ao fim da última, com folga de 0,15 s antes e 0,22 s depois, limitada pelas falas vizinhas que não entram. Trechos vizinhos se encontram no meio da pausa. Só sai silêncio de verdade: menos de -55 dB por mais de 0,45 s. Para conferir, transcreva o vídeo final de novo.
4. `python3 base.py cortes.json bruto.MOV base.mov` faz 1080x1920 a 30 fps. Cada pergunta alterna o zoom entre 100% e 108%, com aproximação lenta de 4% e leve correção de cor.
5. `python3 eventos.py plano.json cortes.json eventos.json` gera os tempos dos elementos no vídeo final.
6. `node quadros.js overlay.html eventos.json quadros/` desenha título, cartão, sublinhado, legenda e fecho, quadro a quadro, com fundo transparente.
7. Montagem com FFmpeg: a base, os quadros por cima, um tick baixo em cada resposta e o áudio a -14 LUFS.

## Vídeo que já chega cortado (pasta EDITADOS)

Os cortes ficam como estão. Só entram o padrão visual e o som.

1. Transcrever o vídeo cortado.
2. Escrever as marcas (`exemplo-marcas-vendas.json`):
   - a primeira palavra de cada pergunta e da resposta;
   - as opções e qual foi escolhida;
   - os trechos de legenda, cada um com a palavra onde começa;
   - a primeira palavra do CTA.
3. `python3 plano_editado.py marcas.json transcricao.json duração cortes.json plano.json` divide o vídeo em blocos contínuos nas trocas de pergunta, em quadros exatos, sem tirar nada.
4. Seguir do passo 4 da edição normal (base, eventos, quadros, montagem).
