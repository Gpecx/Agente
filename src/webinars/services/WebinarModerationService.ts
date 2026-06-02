import { EvolutionWebhookPayload } from '../../interfaces/evolution.interface';
import evolutionApiService from '../../services/EvolutionApiService';
import webinarUserRepository from '../repositories/WebinarUserRepository';
import moderacaoLogRepository from '../repositories/ModeracaoLogRepository';
import messaging from './WebinarMessagingService';
import { webinarConfig } from '../config/webinarConfig';

/**
 * Resultado da análise de conteúdo de uma mensagem.
 */
export interface AnaliseConteudo {
  infracao: boolean;
  motivo?: string;
}

/**
 * Detecta links NÃO autorizados (fora da allowlist) e palavrões (lista configurável).
 * Função estática/pura para facilitar teste e reuso.
 */
export function analisarConteudo(
  texto: string,
  palavroes: string[],
  dominiosPermitidos: string[]
): AnaliseConteudo {
  if (!texto) return { infracao: false };
  const lower = texto.toLowerCase();

  // Palavrão
  for (const p of palavroes) {
    if (p && new RegExp(`\\b${escapeRegex(p)}\\b`, 'i').test(lower)) {
      return { infracao: true, motivo: 'Palavra proibida' };
    }
  }

  // Links: extrai domínios e verifica contra a allowlist
  const urlRegex = /(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:\/[^\s]*)?/gi;
  let m: RegExpExecArray | null;
  while ((m = urlRegex.exec(lower)) !== null) {
    const dominio = m[1];
    // ignora falsos positivos como "10.5" (só dígitos)
    if (/^[\d.]+$/.test(dominio)) continue;
    const permitido = dominiosPermitidos.some(
      (d) => dominio === d || dominio.endsWith(`.${d}`)
    );
    if (!permitido) {
      return { infracao: true, motivo: `Link não autorizado (${dominio})` };
    }
  }

  return { infracao: false };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Moderação do módulo de webinars (spec §3 e §2.7).
 *
 * Diferenças em relação à moderação-base do projeto:
 *  - Respeita uma ALLOWLIST de domínios (só links fora da lista são infração).
 *  - Implementa o "MUTE SIMULADO" de 10 min: como o WhatsApp não permite mutar
 *    um usuário, marcamos `silenciadoAte` e apagamos automaticamente qualquer
 *    nova mensagem dele dentro da janela.
 *  - Loga em `logs_moderacao`.
 *
 * IMPORTANTE: "mute" aqui é uma SIMULAÇÃO (apagar mensagens na janela), não um
 * mute nativo do WhatsApp. Requer que o bot seja admin do grupo.
 */
class WebinarModerationService {
  /**
   * Aplica a moderação do módulo. Deve ser chamado apenas em mensagens de GRUPO.
   * @param skipContentAnalysis quando true, só faz o enforcement do mute (a
   *        moderação-base já tratou o conteúdo, evitando punição dupla).
   * @returns true se alguma ação de moderação foi tomada (mensagem tratada).
   */
  async processMessage(
    payload: EvolutionWebhookPayload,
    texto: string,
    skipContentAnalysis = false
  ): Promise<boolean> {
    const remoteJid = payload.data?.key?.remoteJid;
    const autorJid = payload.data?.key?.participant || remoteJid;
    const messageId = payload.data?.key?.id;
    const fromMe = payload.data?.key?.fromMe ?? false;

    if (!remoteJid || !autorJid || !messageId) return false;
    if (!remoteJid.endsWith('@g.us')) return false; // só modera grupo

    // 1) Enforcement do mute simulado: se o autor está silenciado, apaga a msg.
    const usuario = await webinarUserRepository.get(autorJid);
    const agora = Date.now();
    if (usuario?.silenciadoAte && usuario.silenciadoAte > agora) {
      await evolutionApiService.deleteMessage(payload.instance, remoteJid, messageId, fromMe, autorJid);
      await moderacaoLogRepository.log(
        autorJid,
        'delete',
        'Mensagem apagada durante janela de silêncio (mute simulado)'
      );
      console.log(`🔇 [WebinarModeration] Mensagem de ${autorJid} apagada (em silêncio).`);
      return true;
    }

    if (skipContentAnalysis) return false;

    // 2) Análise de conteúdo (link não autorizado / palavrão)
    const analise = analisarConteudo(
      texto,
      webinarConfig.palavroes,
      webinarConfig.dominiosPermitidos
    );
    if (!analise.infracao) return false;

    await this.punir(payload, remoteJid, autorJid, messageId, fromMe, analise.motivo!);
    return true;
  }

  /** Apaga + DM com a regra + mute 10 min + log. */
  private async punir(
    payload: EvolutionWebhookPayload,
    remoteJid: string,
    autorJid: string,
    messageId: string,
    fromMe: boolean,
    motivo: string
  ): Promise<void> {
    console.log(`🚨 [WebinarModeration] Infração (${motivo}) de ${autorJid} em ${remoteJid}`);

    // Apaga a mensagem infratora
    await evolutionApiService.deleteMessage(payload.instance, remoteJid, messageId, fromMe, autorJid);
    await moderacaoLogRepository.log(autorJid, 'delete', motivo);

    // "Mute" simulado de 10 min
    const ate = Date.now() + webinarConfig.muteDurationMs;
    await webinarUserRepository.setSilenciadoAte(autorJid, ate);
    await moderacaoLogRepository.log(
      autorJid,
      'mute',
      `Silenciado por ${Math.round(webinarConfig.muteDurationMs / 60000)} min — ${motivo}`
    );

    // DM com a regra infringida (force: ação direta de moderação ao infrator).
    const minutos = Math.round(webinarConfig.muteDurationMs / 60000);
    const regra =
      `⚠️ Sua mensagem no grupo foi removida.\n` +
      `*Motivo:* ${motivo}.\n\n` +
      `🔇 Você ficará em silêncio por ${minutos} minutos: novas mensagens suas no grupo ` +
      `serão removidas automaticamente nesse período. Respeite as regras da comunidade.`;
    await messaging.enviarDM(payload.instance, autorJid, regra, {
      force: true,
      motivo: 'moderacao-regra',
    });
    await moderacaoLogRepository.log(autorJid, 'warn', `DM de aviso enviada — ${motivo}`);
  }
}

export default new WebinarModerationService();
