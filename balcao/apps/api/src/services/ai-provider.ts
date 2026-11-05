import Anthropic from '@anthropic-ai/sdk';
import type { Config } from '../config';

/**
 * Acesso ao modelo de linguagem do assistente (Claude, via SDK oficial da Anthropic).
 * A interface é pequena para que os testes usem um provedor roteirizado; em produção,
 * sem ANTHROPIC_API_KEY o assistente fica indisponível (e o painel diz isso).
 */
export interface AiRequest {
  system: Anthropic.Beta.BetaTextBlockParam[];
  messages: Anthropic.Beta.BetaMessageParam[];
  tools: Anthropic.Beta.BetaTool[];
}

export interface AiProvider {
  readonly model: string;
  createMessage(request: AiRequest): Promise<Anthropic.Beta.BetaMessage>;
}

export function createAiProvider(config: Config, fetchImpl: typeof fetch): AiProvider | null {
  if (!config.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, fetch: fetchImpl, maxRetries: 2, timeout: 60_000 });
  const model = config.AI_MODEL;
  return {
    model,
    async createMessage(request) {
      return client.beta.messages.create({
        model,
        // O pensamento conta dentro de max_tokens; respostas de atendimento são curtas.
        max_tokens: 16000,
        // Conversa de atendimento: esforço baixo responde rápido e custa menos.
        output_config: { effort: 'low' },
        // Se os filtros de segurança recusarem por engano, a própria API tenta o modelo recomendado.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: request.system,
        messages: request.messages,
        tools: request.tools,
      });
    },
  };
}
