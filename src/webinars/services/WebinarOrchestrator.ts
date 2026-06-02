import { EvolutionWebhookPayload } from '../../interfaces/evolution.interface';
import reactionService from './WebinarReactionService';
import commandHandler from './WebinarCommandHandler';
import webinarModerationService from './WebinarModerationService';
import participantService from './WebinarParticipantService';
import faqService from './FaqService';

/**
 * Ponto de entrada do módulo de Webinars, acoplado ao roteamento de webhook
 * existente (WebhookController) de forma ADITIVA — não substitui a moderação-base.
 *
 * Ordem de processamento em `messages.upsert`:
 *   1. Reação (opt-in) — se for reactionMessage, trata e encerra.
 *   2. Comando (§4) — se for comando, trata e encerra.
 *   3. Moderação do módulo — enforcement do mute simulado + regra de conteúdo.
 */
class WebinarOrchestrator {
  /**
   * @param texto        texto já extraído pela moderação-base (evita re-extrair).
   * @param baseHandled  se a moderação-base já puniu a mensagem (evita punição dupla).
   */
  async onMessage(
    payload: EvolutionWebhookPayload,
    texto: string | null,
    baseHandled: boolean
  ): Promise<void> {
    try {
      // 1. Reação (opt-in) — reações não têm texto de conversa.
      if (await reactionService.handle(payload)) return;

      // 2. Moderação do módulo (enforcement do mute simulado + conteúdo).
      //    Roda ANTES dos comandos: mensagens de quem está em silêncio são
      //    apagadas inclusive se forem comandos. Se a base já puniu o conteúdo,
      //    passamos skipContentAnalysis para não punir em dobro (mas ainda
      //    aplicamos o enforcement de mute).
      if (texto) {
        const moderou = await webinarModerationService.processMessage(
          payload,
          texto,
          baseHandled
        );
        if (moderou) return;
      }

      // 3. Comando (só chega aqui se a mensagem não foi moderada/apagada).
      if (texto && (await commandHandler.handle(payload, texto))) return;

      // 4. FAQ (dúvida frequente) — só se não era comando e há base configurada.
      if (texto) {
        await faqService.handle(payload, texto);
      }
    } catch (error) {
      console.error('❌ [WebinarOrchestrator] Erro ao processar mensagem:', error);
    }
  }

  /** Delegação do evento de entrada no grupo. */
  async onParticipantUpdate(payload: EvolutionWebhookPayload): Promise<void> {
    try {
      await participantService.handleEntrada(payload);
    } catch (error) {
      console.error('❌ [WebinarOrchestrator] Erro ao processar entrada no grupo:', error);
    }
  }
}

export default new WebinarOrchestrator();
