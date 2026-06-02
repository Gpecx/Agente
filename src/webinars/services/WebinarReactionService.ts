import { EvolutionWebhookPayload } from '../../interfaces/evolution.interface';
import webinarUserRepository from '../repositories/WebinarUserRepository';
import { webinarConfig } from '../config/webinarConfig';

/**
 * Trata reações (reactionMessage) que chegam dentro de `messages.upsert`.
 *
 * Mecanismo de OPT-IN (spec §2.4): quando um usuário reage com o emoji
 * configurado (default 🔥), gravamos `notificacao = true` — habilitando o
 * envio de DMs de lembrete para ele.
 *
 * Reagir com outro emoji (ou remover a reação) não altera o opt-in para não
 * surpreender o usuário; a remoção explícita pode ser tratada depois se preciso.
 */
class WebinarReactionService {
  /**
   * @returns true se o evento era uma reação (tratada), false caso contrário.
   */
  async handle(payload: EvolutionWebhookPayload): Promise<boolean> {
    const reaction = payload.data?.message?.reactionMessage;
    if (!reaction) return false;

    // O emoji da reação vem em `text`.
    const emoji: string | undefined = reaction.text;

    // Quem reagiu: em grupos, o participant; senão o remoteJid.
    const reagenteJid =
      payload.data?.key?.participant || payload.data?.key?.remoteJid;

    if (!reagenteJid) return true; // era reação, mas sem autor identificável

    if (emoji && emoji === webinarConfig.optInEmoji) {
      await webinarUserRepository.setOptIn(reagenteJid, true, payload.data?.pushName);
      console.log(
        `🔥 [WebinarReaction] Opt-in registrado para ${reagenteJid} (reação ${emoji}).`
      );
    } else {
      console.log(
        `↩️ [WebinarReaction] Reação "${emoji}" de ${reagenteJid} ignorada (não é o emoji de opt-in).`
      );
    }
    return true;
  }
}

export default new WebinarReactionService();
