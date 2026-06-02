import { EvolutionWebhookPayload } from '../../interfaces/evolution.interface';
import webinarRepository from '../repositories/WebinarRepository';
import webinarUserRepository from '../repositories/WebinarUserRepository';
import messaging from './WebinarMessagingService';

/**
 * Reage ao evento `group-participants.update` (action `add`) — entrada de
 * novos membros (spec §3).
 *
 * ⚠️ ANTI-BAN (spec §2.3): enviar DM de boas-vindas para quem NÃO interagiu é a
 * principal causa de ban de contas no WhatsApp. Por padrão, NÃO enviamos a
 * DM automaticamente: registramos o usuário e postamos as boas-vindas + CTA no
 * GRUPO (onde DM não é necessária). A DM de boas-vindas só sai se o usuário já
 * tiver opt-in (improvável na entrada), respeitando o gate do messaging.
 *
 * Para forçar a DM mesmo assim (cenário de risco assumido), defina
 * WEBINAR_WELCOME_DM=true — nesse caso ela passa pelo rate limit do messaging.
 */
class WebinarParticipantService {
  /** Lido a cada chamada para garantir que o dotenv já carregou. */
  private get forcarDM(): boolean {
    return process.env.WEBINAR_WELCOME_DM === 'true';
  }

  async handleEntrada(payload: EvolutionWebhookPayload): Promise<void> {
    if (payload.data?.action !== 'add') return;

    const remoteJid = payload.data?.id || payload.data?.key?.remoteJid || payload.data?.groupJid;
    const participants = payload.data?.participants || [];
    if (!remoteJid || participants.length === 0) return;

    const webinar = await webinarRepository.getProximo();
    const agora = new Date();

    let cta = '';
    if (webinar) {
      const dataFmt = webinar.dataHora.toLocaleString('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      });
      const diasAte =
        (webinar.dataHora.getTime() - agora.getTime()) / (24 * 60 * 60 * 1000);
      cta =
        `\n\n📅 Próximo webinar: *${webinar.tema}* em ${dataFmt}.` +
        (diasAte >= 0 && diasAte < 7
          ? `\n🚀 É em menos de 7 dias! Garanta sua vaga: ${webinar.linkSala}`
          : '');
    }

    for (const jid of participants) {
      await webinarUserRepository.ensure(jid, payload.data?.pushName);

      const texto =
        `👋 Bem-vindo(a)! Aqui você acompanha nossos webinars.\n\n` +
        `📜 *Regras:* sem links não autorizados e sem ofensas — o grupo é moderado por IA.\n` +
        `🔔 Reaja com o emoji de lembrete nos avisos para receber DMs antes da live.` +
        cta;

      if (this.forcarDM) {
        // Cenário de risco assumido: DM passa pelo rate limit do messaging.
        await messaging.enviarDM(payload.instance, jid, texto, {
          force: true,
          motivo: 'boas-vindas (WEBINAR_WELCOME_DM=true — RISCO anti-ban)',
        });
      } else {
        // Padrão seguro: boas-vindas no próprio grupo, mencionando o novo membro.
        const numero = jid.split('@')[0];
        await messaging.enviarGrupoComMencao(
          payload.instance,
          remoteJid,
          `@${numero} ` + texto,
          jid
        );
      }
    }
  }
}

export default new WebinarParticipantService();
