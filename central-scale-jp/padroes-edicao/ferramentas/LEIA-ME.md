# Edição no padrão pergunta e resposta: ferramentas

Primeiro vídeo feito assim: R001x (Isso ou aquilo: MARKETING), em 11/11/2026.

1. Transcrever o bruto com tempo por palavra (faster-whisper, modelo medium, pt).
2. Escrever o plano do vídeo (`exemplo-r001x.json`). Ele define os trechos do bruto que entram: abertura, pergunta e resposta de cada item, legendas e CTA. Também define o texto das opções e qual foi escolhida.
3. `python3 cortes.py plano.json audio.wav cortes.json` ajusta cada trecho pela energia do áudio. Corta silêncio e mantém o fim das palavras.
4. `python3 base.py cortes.json bruto.MOV base.mov` faz 1080x1920 a 30 fps. Cada pergunta alterna o zoom entre 100% e 108%, com aproximação lenta de 4% e leve correção de cor.
5. `python3 eventos.py plano.json cortes.json eventos.json` gera os tempos dos elementos no vídeo final.
6. `node quadros.js overlay.html eventos.json quadros/` desenha título, cartão, sublinhado, legenda e fecho, quadro a quadro, com fundo transparente.
7. Montagem com FFmpeg: a base, os quadros por cima, um tick baixo em cada resposta e o áudio a -14 LUFS.
