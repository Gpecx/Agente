import { EvolutionWebhookPayload } from '../../interfaces/evolution.interface';
import messaging from './WebinarMessagingService';
import { webinarConfig } from '../config/webinarConfig';

export interface FaqEntry {
  /** Palavras-chave (qualquer uma presente no texto dispara a resposta). */
  keywords: string[];
  resposta: string;
  link?: string;
}

/**
 * Detecção de dúvidas frequentes (spec §3). A base de FAQ é configurável via
 * env `WEBINAR_FAQ` (JSON). Se não configurada, o serviço fica DESLIGADO para
 * não responder mensagens indevidamente (evita spam).
 *
 * Exemplo de WEBINAR_FAQ:
 * [{"keywords":["certificado","horas"],"resposta":"O certificado exige 80% de presença.","link":"https://docs..."}]
 */
class FaqService {
  private faq: FaqEntry[] = this.carregar();

  private carregar(): FaqEntry[] {
    const raw = process.env.WEBINAR_FAQ;
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as FaqEntry[];
      console.warn('⚠️ [FaqService] WEBINAR_FAQ não é um array. Ignorado.');
      return [];
    } catch (error) {
      console.warn('⚠️ [FaqService] WEBINAR_FAQ inválido (JSON). Ignorado.', error);
      return [];
    }
  }

  /**
   * Tenta responder uma dúvida frequente. Só atua em GRUPO e quando a base de
   * FAQ está configurada.
   * @returns true se respondeu a uma FAQ.
   */
  async handle(payload: EvolutionWebhookPayload, texto: string): Promise<boolean> {
    if (this.faq.length === 0 || !texto) return false;

    const remoteJid = payload.data?.key?.remoteJid;
    if (!remoteJid || !remoteJid.endsWith('@g.us')) return false;

    const lower = texto.toLowerCase();
    const match = this.faq.find((f) =>
      f.keywords.some((k) => lower.includes(k.toLowerCase()))
    );
    if (!match) return false;

    const link = match.link || webinarConfig.docsUrl;
    const corpo = `💡 ${match.resposta}` + (link ? `\n📚 Saiba mais: ${link}` : '');

    await messaging.enviarComOpcoes(
      payload.instance,
      remoteJid,
      corpo + '\n\nIsso te ajudou?',
      ['Sim, obrigado!', 'Ainda tenho dúvida'],
      { isGroup: true }
    );
    return true;
  }
}

export default new FaqService();
