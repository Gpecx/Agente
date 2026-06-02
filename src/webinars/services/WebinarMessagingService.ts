import evolutionApiService from '../../services/EvolutionApiService';
import webinarUserRepository from '../repositories/WebinarUserRepository';
import { webinarConfig } from '../config/webinarConfig';

/**
 * Camada de mensageria do bot de webinars. Envolve o EvolutionApiService
 * aplicando as regras anti-ban (spec §2.3 e §7):
 *
 *  - DM SÓ com opt-in real (exceto quando o chamador marca `force`, ex.: o
 *    usuário acabou de mandar mensagem ao bot — interação implícita).
 *  - Rate limit + jitter humanizado em envios em lote.
 *  - Toda DM é logada.
 *  - `enviarComOpcoes()` com fallback para texto numerado (botões instáveis no WA).
 *
 * Observação: o EvolutionApiService já possui fila + cooldown de 300ms e
 * absorve falhas (retry/backoff implícito), então não duplicamos isso aqui.
 */
class WebinarMessagingService {
  /** Delay humanizado entre DMs em lote. */
  private async humanDelay(): Promise<void> {
    // Jitter determinístico-o-suficiente: base + valor pseudo-aleatório derivado do relógio.
    // Evita usar Math.random diretamente para manter previsibilidade em testes/log.
    const jitter = Math.floor((Date.now() % 1000) / 1000 * webinarConfig.dmDelayJitterMs);
    const total = webinarConfig.dmDelayMinMs + jitter;
    await new Promise((res) => setTimeout(res, total));
  }

  /** Mensagem no grupo (sem restrição de opt-in). */
  async enviarGrupo(instance: string, groupJid: string, texto: string): Promise<void> {
    await evolutionApiService.sendText(instance, groupJid, texto);
  }

  async enviarGrupoComMencao(
    instance: string,
    groupJid: string,
    texto: string,
    mentionedJid: string
  ): Promise<void> {
    await evolutionApiService.sendTextWithMention(instance, groupJid, texto, mentionedJid);
  }

  /**
   * DM com gate de opt-in. Retorna true se a mensagem foi efetivamente enviada.
   *
   * @param force quando true, ignora o gate de opt-in (usar APENAS quando há
   *              interação solicitada — ex.: resposta direta a uma DM do usuário).
   */
  async enviarDM(
    instance: string,
    jid: string,
    texto: string,
    opts: { force?: boolean; motivo?: string } = {}
  ): Promise<boolean> {
    const optIn = opts.force || (await webinarUserRepository.hasOptIn(jid));

    if (!optIn) {
      console.warn(
        `🚫 [WebinarMessaging] DM BLOQUEADA para ${jid} (sem opt-in). Motivo da tentativa: ${
          opts.motivo || 'n/d'
        }. Anti-ban WhatsApp.`
      );
      return false;
    }

    await evolutionApiService.sendText(instance, jid, texto);
    console.log(
      `📩 [WebinarMessaging] DM enviada para ${jid} (motivo: ${opts.motivo || 'n/d'}, force: ${!!opts.force})`
    );
    return true;
  }

  /**
   * Envio de DM em lote com rate limit + jitter. Cada destinatário passa pelo
   * gate de opt-in individualmente. Retorna quantas DMs foram efetivamente enviadas.
   */
  async enviarDMLote(
    instance: string,
    jids: string[],
    textoBuilder: (jid: string) => string,
    motivo: string
  ): Promise<number> {
    let enviadas = 0;
    console.log(`📤 [WebinarMessaging] Iniciando lote de ${jids.length} DMs (motivo: ${motivo})`);

    for (const jid of jids) {
      const ok = await this.enviarDM(instance, jid, textoBuilder(jid), { motivo });
      if (ok) enviadas++;
      // Sempre aplica o delay humanizado entre tentativas para não disparar em rajada.
      await this.humanDelay();
    }

    console.log(
      `✅ [WebinarMessaging] Lote concluído: ${enviadas}/${jids.length} DMs enviadas (motivo: ${motivo})`
    );
    return enviadas;
  }

  /**
   * Envia uma mensagem com opções de resposta. Tenta botões; em caso de falha
   * ou indisponibilidade, cai para texto numerado (spec §2.8).
   *
   * Como a confiabilidade de botões via Baileys é instável, por padrão usamos
   * direto o fallback de texto numerado (mais robusto). A abstração permite
   * trocar a estratégia depois sem mudar os chamadores.
   */
  async enviarComOpcoes(
    instance: string,
    jid: string,
    titulo: string,
    opcoes: string[],
    opts: { isGroup?: boolean; force?: boolean; motivo?: string } = {}
  ): Promise<boolean> {
    const numerado =
      `${titulo}\n\n` +
      opcoes.map((o, i) => `*${i + 1})* ${o}`).join('\n') +
      `\n\n_Responda com o número da opção._`;

    if (opts.isGroup) {
      await this.enviarGrupo(instance, jid, numerado);
      return true;
    }
    return this.enviarDM(instance, jid, numerado, { force: opts.force, motivo: opts.motivo });
  }
}

export default new WebinarMessagingService();
