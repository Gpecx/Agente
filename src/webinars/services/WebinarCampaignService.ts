import evolutionApiService from '../../services/EvolutionApiService';
import { Webinar } from '../interfaces/webinar.interface';
import messaging from './WebinarMessagingService';
import webinarUserRepository from '../repositories/WebinarUserRepository';
import formularioRepository from '../repositories/FormularioRepository';
import presencaRepository from '../repositories/PresencaRepository';
import { webinarConfig } from '../config/webinarConfig';

/**
 * Ações de campanha proativas, disparadas pelo scheduler. Cada método já assume
 * que a idempotência (não repetir) foi garantida pelo chamador (CronExecRepository).
 */
class WebinarCampaignService {
  private get instance(): string {
    return webinarConfig.evolutionInstance;
  }
  private get grupo(): string {
    return webinarConfig.webinarGroupJid;
  }

  private guard(): boolean {
    if (!this.instance || !this.grupo) {
      console.warn(
        '⚠️ [WebinarCampaign] EVOLUTION_INSTANCE ou WEBINAR_GROUP_JID ausentes. Ação proativa ignorada.'
      );
      return false;
    }
    return true;
  }

  private dataFmt(w: Webinar): string {
    return w.dataHora.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }

  /** Substituto do "pin" (spec §2.6): atualiza a descrição do grupo. */
  async atualizarInfoFixada(w: Webinar): Promise<void> {
    if (!this.guard()) return;
    const info =
      `📌 Próximo webinar: ${w.tema}\n` +
      `🗓️ ${this.dataFmt(w)} | 🎤 ${w.palestrante}\n` +
      `Reaja ${webinarConfig.optInEmoji} nos avisos para receber lembretes.`;
    await evolutionApiService.updateGroupDescription(this.instance, this.grupo, info);
  }

  /** D-7/D-3/D-1: teaser + enquete + atualização da info fixada. */
  async postarTeaser(w: Webinar, fase: 'D-7' | 'D-3' | 'D-1'): Promise<void> {
    if (!this.guard()) return;

    const teasers: Record<string, string> = {
      'D-7': `🚀 Falta 1 semana para o webinar *${w.tema}*!\n🎤 Com ${w.palestrante} — ${this.dataFmt(w)}.\nReaja com ${webinarConfig.optInEmoji} para ser lembrado!`,
      'D-3': `⏳ Faltam 3 dias para *${w.tema}*!\nReaja com ${webinarConfig.optInEmoji} e receba o lembrete no seu privado.`,
      'D-1': `🔥 É amanhã! *${w.tema}* com ${w.palestrante} — ${this.dataFmt(w)}.\nReaja com ${webinarConfig.optInEmoji} para o lembrete da véspera!`,
    };

    await messaging.enviarGrupo(this.instance, this.grupo, teasers[fase]);

    // Enquete (best-effort, spec §2.5)
    await evolutionApiService.sendPoll(
      this.instance,
      this.grupo,
      `Você vai participar do webinar "${w.tema}"?`,
      ['Com certeza! 🔥', 'Vou tentar', 'Não poderei']
    );

    await this.atualizarInfoFixada(w);
  }

  /**
   * 1h / 10min antes: DM para quem deu opt-in OU é membro recente (<30 dias).
   * O gate de opt-in no messaging garante que membros sem opt-in não recebam.
   */
  async enviarLembrete(w: Webinar, fase: '1h' | '10min'): Promise<number> {
    if (!this.instance) {
      console.warn('⚠️ [WebinarCampaign] EVOLUTION_INSTANCE ausente. Lembrete ignorado.');
      return 0;
    }

    const optIns = await webinarUserRepository.listOptIn();
    const recentes = await webinarUserRepository.listMembrosRecentes(
      webinarConfig.membroRecenteDias
    );
    const alvos = Array.from(new Set([...optIns, ...recentes]));

    const texto =
      fase === '1h'
        ? `⏰ Começa em 1h: *${w.tema}*!\n🎧 Teste seu áudio: ${w.linkSala}`
        : `🚨 Começa em 10 minutos: *${w.tema}*!\nEntre na sala agora: ${w.linkSala}`;

    return messaging.enviarDMLote(
      this.instance,
      alvos,
      () => texto,
      `lembrete-${fase}`
    );
  }

  /**
   * Webinar +30min (encerrado): abre coleta de NPS.
   * 1) posta form no grupo · 2) DM para quem esteve online.
   */
  async abrirColeta(w: Webinar): Promise<void> {
    if (!this.guard()) return;

    // Form NPS no grupo (enquete 0-10 simplificada em faixas + instrução)
    await messaging.enviarGrupo(
      this.instance,
      this.grupo,
      `🙏 Obrigado por participar de *${w.tema}*!\n\n` +
        `📝 Responda nossa pesquisa rápida (NPS): de 0 a 10, o quanto recomendaria?\n` +
        `Responda aqui no grupo ou no privado. Quem completar libera o e-book e o certificado!`
    );

    // DM para quem esteve online (tem registro de presença), respeitando opt-in
    const presencas = await presencaRepository.listarPorWebinar(w.id);
    const presentes = presencas.filter((p) => p.percentual > 0).map((p) => p.usuarioId);

    await messaging.enviarDMLote(
      this.instance,
      presentes,
      () =>
        `🎓 Você participou de *${w.tema}*!\n` +
        `Responda o NPS (0-10) e libere seu *e-book* (\`/ebook\`) e *certificado* (\`/certificado\`).`,
      'coleta-nps'
    );
  }

  /** D+1: lembrete para quem não completou o formulário. */
  async lembrarFormIncompleto(w: Webinar): Promise<number> {
    if (!this.instance) return 0;
    const incompletos = await formularioRepository.listarIncompletosPorWebinar(w.id);
    return messaging.enviarDMLote(
      this.instance,
      incompletos,
      () =>
        `📋 Você ainda não finalizou o formulário de *${w.tema}*.\n` +
        `Complete-o para liberar seu e-book e certificado!`,
      'lembrete-form-incompleto'
    );
  }
}

export default new WebinarCampaignService();
