import { EvolutionWebhookPayload } from '../../interfaces/evolution.interface';
import { parseComando, ComandoParseado } from './commandParser';
import { resolveEstado } from '../state/resolveEstado';
import { EstadoWebinar, Webinar } from '../interfaces/webinar.interface';
import webinarRepository from '../repositories/WebinarRepository';
import webinarUserRepository from '../repositories/WebinarUserRepository';
import perguntaRepository from '../repositories/PerguntaRepository';
import presencaRepository from '../repositories/PresencaRepository';
import formularioRepository from '../repositories/FormularioRepository';
import certificateService from './CertificateService';
import messaging from './WebinarMessagingService';
import evolutionApiService from '../../services/EvolutionApiService';
import { webinarConfig } from '../config/webinarConfig';

/**
 * Parser + dispatch dos comandos do bot (spec §4).
 *
 * Comandos podem chegar no grupo ou em DM. Quando o usuário fala com o bot
 * (grupo ou DM), isso conta como interação solicitada, então respostas a
 * comandos são permitidas mesmo sem opt-in prévio (`force` nas DMs).
 */
class WebinarCommandHandler {
  private isGroup(remoteJid: string): boolean {
    return remoteJid.endsWith('@g.us');
  }

  /** Responde no canal de origem (grupo ou DM do autor). */
  private async responder(
    instance: string,
    remoteJid: string,
    autorJid: string,
    texto: string
  ): Promise<void> {
    if (this.isGroup(remoteJid)) {
      await messaging.enviarGrupo(instance, remoteJid, texto);
    } else {
      // DM direta ao bot = interação solicitada -> force
      await messaging.enviarDM(instance, autorJid, texto, { force: true, motivo: 'resposta-comando' });
    }
  }

  /**
   * Tenta tratar a mensagem como comando.
   * @returns true se a mensagem ERA um comando (tratado), false caso contrário.
   */
  async handle(payload: EvolutionWebhookPayload, texto: string): Promise<boolean> {
    const parsed = parseComando(texto);
    if (!parsed) return false;

    const remoteJid = payload.data?.key?.remoteJid;
    const autorJid = payload.data?.key?.participant || remoteJid;
    if (!remoteJid || !autorJid) return false;

    const pushName = payload.data?.pushName;
    // Interação com o bot conta como opt-in implícito (spec §2.3).
    await webinarUserRepository.setOptIn(autorJid, true, pushName);

    const webinar = await webinarRepository.getProximo();

    try {
      switch (parsed.comando) {
        case 'ajuda':
          return await this.cmdAjuda(payload.instance, remoteJid, autorJid);
        case 'proximo':
          return await this.cmdProximo(payload.instance, remoteJid, autorJid, webinar);
        case 'pergunta':
          return await this.cmdPergunta(payload.instance, remoteJid, autorJid, webinar, parsed);
        case 'presente':
          return await this.cmdPresente(payload.instance, remoteJid, autorJid, webinar);
        case 'certificado':
          return await this.cmdCertificado(payload.instance, remoteJid, autorJid, webinar);
        case 'ebook':
          return await this.cmdEbook(payload.instance, remoteJid, autorJid, webinar);
        default:
          return false;
      }
    } catch (error) {
      console.error(`❌ [WebinarCommandHandler] Erro ao executar /${parsed.comando}:`, error);
      return true; // era comando, apenas falhou — não cai na moderação
    }
  }

  private async cmdAjuda(instance: string, remoteJid: string, autorJid: string): Promise<boolean> {
    const texto =
      '🤖 *Comandos disponíveis:*\n\n' +
      '`/proximo` — data, tema e palestrante do próximo webinar\n' +
      '`/presente` — registra sua presença (durante a live)\n' +
      '`/certificado` — libera seu certificado (pós-evento, presença > 80% + formulário)\n' +
      '`/ebook` — libera o e-book (pós-evento, formulário preenchido)\n' +
      '`/pergunta <texto>` — envia uma dúvida para o host\n' +
      '`/ajuda` — mostra esta lista';
    await this.responder(instance, remoteJid, autorJid, texto);
    return true;
  }

  private async cmdProximo(
    instance: string,
    remoteJid: string,
    autorJid: string,
    webinar: Webinar | null
  ): Promise<boolean> {
    if (!webinar) {
      await this.responder(
        instance,
        remoteJid,
        autorJid,
        '📭 Não há nenhum webinar agendado no momento. Fique de olho no grupo!'
      );
      return true;
    }
    const dataFmt = webinar.dataHora.toLocaleString('pt-BR', {
      dateStyle: 'full',
      timeStyle: 'short',
    });
    const texto =
      `📅 *Próximo webinar*\n\n` +
      `*Tema:* ${webinar.tema}\n` +
      `*Palestrante:* ${webinar.palestrante}\n` +
      `*Quando:* ${dataFmt}`;
    await this.responder(instance, remoteJid, autorJid, texto);
    return true;
  }

  private async cmdPergunta(
    instance: string,
    remoteJid: string,
    autorJid: string,
    webinar: Webinar | null,
    parsed: ComandoParseado
  ): Promise<boolean> {
    if (!parsed.args) {
      await this.responder(
        instance,
        remoteJid,
        autorJid,
        '❓ Use: `/pergunta sua dúvida aqui`'
      );
      return true;
    }
    await perguntaRepository.registrar(autorJid, webinar?.id || 'sem-webinar', parsed.args);
    await this.responder(
      instance,
      remoteJid,
      autorJid,
      '✅ Pergunta registrada para o host. Obrigado!'
    );
    return true;
  }

  private async cmdPresente(
    instance: string,
    remoteJid: string,
    autorJid: string,
    webinar: Webinar | null
  ): Promise<boolean> {
    const agora = new Date();
    const estado = webinar ? resolveEstado(webinar, agora) : EstadoWebinar.IDLE;

    if (!webinar || estado !== EstadoWebinar.DIA_D) {
      const msg =
        !webinar || agora.getTime() < (webinar?.dataHora.getTime() ?? Infinity)
          ? '⏳ A live ainda não começou. O comando `/presente` ficará disponível durante o evento.'
          : '🔚 A live já terminou. Não é mais possível registrar presença.';
      await this.responder(instance, remoteJid, autorJid, msg);
      return true;
    }

    await presencaRepository.checkIn(autorJid, webinar.id);
    await this.responder(
      instance,
      remoteJid,
      autorJid,
      '✅ Presença registrada! Continue na sala para garantir seu certificado (presença > 80%).'
    );
    return true;
  }

  private async cmdCertificado(
    instance: string,
    remoteJid: string,
    autorJid: string,
    webinar: Webinar | null
  ): Promise<boolean> {
    if (!webinar) {
      await this.responder(instance, remoteJid, autorJid, '📭 Nenhum webinar encontrado.');
      return true;
    }
    const estado = resolveEstado(webinar, new Date());
    if (estado === EstadoWebinar.AQUECIMENTO || estado === EstadoWebinar.DIA_D) {
      await this.responder(
        instance,
        remoteJid,
        autorJid,
        '⏳ O certificado fica disponível somente após o término da live.'
      );
      return true;
    }

    const resultado = await certificateService.emitir(autorJid, webinar);
    if (!resultado.liberado) {
      await this.responder(
        instance,
        remoteJid,
        autorJid,
        `🚫 Não foi possível liberar o certificado.\n${resultado.motivo}`
      );
      return true;
    }

    // Entrega sempre via DM (documento PDF). force=true: o usuário pediu.
    await evolutionApiService.sendMedia(instance, autorJid, {
      mediatype: 'document',
      media: resultado.base64!,
      fileName: resultado.fileName,
      caption: `🎓 Seu certificado do webinar "${webinar.tema}". Parabéns!`,
    });

    if (this.isGroup(remoteJid)) {
      await messaging.enviarGrupo(
        instance,
        remoteJid,
        '🎓 Certificado enviado no seu privado!'
      );
    }
    return true;
  }

  private async cmdEbook(
    instance: string,
    remoteJid: string,
    autorJid: string,
    webinar: Webinar | null
  ): Promise<boolean> {
    if (!webinar) {
      await this.responder(instance, remoteJid, autorJid, '📭 Nenhum webinar encontrado.');
      return true;
    }
    const formOk = await formularioRepository.isCompleto(autorJid, webinar.id);
    if (!formOk) {
      await this.responder(
        instance,
        remoteJid,
        autorJid,
        '🚫 Preencha o formulário (NPS) primeiro para liberar o e-book.'
      );
      return true;
    }

    const link = webinarConfig.ebookUrl || '(link do e-book não configurado)';
    await messaging.enviarDM(
      instance,
      autorJid,
      `📚 Aqui está seu e-book: ${link}`,
      { force: true, motivo: 'entrega-ebook' }
    );
    if (this.isGroup(remoteJid)) {
      await messaging.enviarGrupo(instance, remoteJid, '📚 E-book enviado no seu privado!');
    }
    return true;
  }
}

export default new WebinarCommandHandler();
