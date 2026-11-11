# Padrão de edição: pergunta e resposta (v2, 11/11/2026)

Vale para **Isso ou aquilo**, **Mito ou verdade** e **Bate-bola**. Dados para a edição automática: `pergunta-resposta.json`.

**Ideia:** edição limpa e suave. O JP é o centro; na tela só aparece o que ajuda a entender a pergunta. Nada de contador, pílulas pulando, emoji, efeito sonoro alto ou legenda piscando palavra por palavra.

## Arquivo
1080 x 1920, 30 fps, H.264. Duração alvo de 35 a 40 s, nunca acima de 45 s.
Cores do JP: azul-marinho #16294A, off-white #F4F1EA, dourado #E0B84F. No Scale: azul #0B2A8A e dourado #C9A24D. Fonte Montserrat (700 no texto, 800 nos títulos).

## Elementos (são só quatro)
1. **Título de abertura (0 a 2 s).** Rótulo pequeno em dourado com uma linha fina ao lado (ISSO OU AQUILO) e o tema grande em off-white embaixo. O texto sobe de dentro de uma máscara em 0,5 s, com desaceleração suave. Sai em fade de 0,3 s no “Valendo”.
2. **Cartão da pergunta.** Um único cartão no terço de cima, azul-marinho a 85% com desfoque do fundo e cantos de 28 px. Dentro, as duas opções separadas por um “ou” pequeno em dourado. Entra subindo 12 px com fade em 0,35 s e sai em fade de 0,25 s quando começa a próxima pergunta.
   - **Resposta:** um sublinhado dourado se desenha embaixo da opção escolhida (0,3 s) e a outra baixa para 40%. Se o JP responder outra coisa, as duas baixam e a resposta curta entra no lugar do “ou”.
   - **Mito ou verdade:** o cartão mostra a frase; na resposta entra uma etiqueta MITO (off-white) ou VERDADE (dourado), crescendo de 96% para 100% com fade.
3. **Legenda das explicações.** Só quando o JP explica (mais de 4 palavras). Até duas linhas, texto normal (não em caixa alta), Montserrat 700, a 72% da altura. Entra frase a frase com fade, sem palavras pulando. A palavra principal fica em dourado.
4. **Fecho (1,5 a 2 s).** Cartão igual ao da pergunta com o @ do perfil e a chamada do funil (topo: “Segue pra ver o próximo”).

## Movimento de câmera
- Corte seco no vídeo a cada pergunta, alternando o enquadramento entre 100% e 108% para esconder o pulo.
- Dentro de cada trecho, aproximação contínua e lenta (de 100% para 104%), que dá vida sem chamar atenção.
- Sem punch, sem tremida, sem transição de efeito. Quem anima são os elementos, não o vídeo.

## Ritmo e som
- A voz de quem filma fica, com no máximo 0,15 s entre a pergunta e a resposta. Silêncio acima de 0,35 s sai.
- Um único “tick” bem baixo quando a resposta é marcada (a 20% do volume da voz). Mais nada.
- Música só no Instagram, na hora de postar.

## Cor
Correção leve: um pouco mais de contraste, pele natural, branco levemente quente. Nada de filtro marcado.

## Takes
O roteiro manda na ordem. Cada pergunta usa o último take completo, a não ser que um anterior esteja melhor. Palavra diferente do roteiro não tem problema se a ideia for a mesma. Se passar de 40 s, saem as perguntas mais fracas do meio; a primeira e a última ficam sempre.

## Capa
Frame do JP com expressão, rótulo pequeno em dourado e o tema grande em off-white. Sempre a foto dele.
