import { EvolutionWebhookPayload } from '../../interfaces/evolution.interface';
import { sparkConfig } from '../config/sparkConfig';
import sparkMemberRepository from '../repositories/SparkMemberRepository';
import messaging from './SparkMessagingService';
import { SparkUsageLevel } from '../interfaces/spark.interface';

class SparkCommunityOrchestrator {
  private readonly PLAN_KEYWORDS = [
    'planos',
    'plano',
    'preco',
    'precos',
    'valor',
    'valores',
    'assinatura',
    'assinaturas',
    'upgrade',
    'custa',
    'custam',
    'mensal',
    'mensais',
  ];
  private readonly SUPPORT_KEYWORDS = ['ajuda', 'suporte', 'especialista', 'humano'];
  private readonly KEY_KEYWORDS = ['chave', 'ativacao', 'ativar', 'acesso'];

  private isGroup(jid: string): boolean {
    return jid.endsWith('@g.us');
  }

  private isAdminCommand(text: string): boolean {
    return text.startsWith('spark ') || text.startsWith('/spark ');
  }

  private normalize(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private computeSegment(jid: string): 'A' | 'B' | 'C' {
    const sum = Array.from(jid).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return ['A', 'B', 'C'][sum % 3] as 'A' | 'B' | 'C';
  }

  private trialEndsAt(agora: Date): Date {
    return new Date(agora.getTime() + sparkConfig.trialDays * 24 * 60 * 60 * 1000);
  }

  private weekKey(date: Date): string {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
  }

  private async sendKeyFlow(instance: string, jid: string, segmento: 'A' | 'B' | 'C'): Promise<void> {
    const ativacao = sparkConfig.activationUrl ? `\nAtive aqui: ${sparkConfig.activationUrl}` : '';
    await messaging.enviarDM(
      instance,
      jid,
      [
        `Seu acesso Spark foi preparado no segmento *${segmento}*.`,
        `Chave: *${sparkConfig.defaultKey}*`,
        ativacao.trim(),
        '',
        sparkConfig.mainMenuText,
      ]
        .filter(Boolean)
        .join('\n')
    );
    await sparkMemberRepository.markKeyDelivered(jid);
  }

  private async sendMainMenu(instance: string, jid: string): Promise<void> {
    await messaging.enviarDM(instance, jid, sparkConfig.mainMenuText);
  }

  private isMenuShortcut(text: string): boolean {
    return text === 'spark' || text === '/spark';
  }

  private isSparkIntentText(text: string | null): boolean {
    if (!text) return false;
    const normalized = this.normalize(text);

    return (
      this.isMenuShortcut(normalized) ||
      this.isAdminCommand(normalized) ||
      this.PLAN_KEYWORDS.some((keyword) => normalized.includes(keyword)) ||
      this.SUPPORT_KEYWORDS.some((keyword) => normalized.includes(keyword)) ||
      this.KEY_KEYWORDS.some((keyword) => normalized.includes(keyword))
    );
  }

  private async ensureMember(jid: string, pushName: string) {
    const existente = await sparkMemberRepository.get(jid);
    if (existente) return existente;
    return sparkMemberRepository.ensure(
      jid,
      pushName,
      this.computeSegment(jid),
      this.trialEndsAt(new Date())
    );
  }

  private async responderNoCanal(
    instance: string,
    remoteJid: string,
    autorJid: string,
    texto: string
  ): Promise<void> {
    if (this.isGroup(remoteJid)) {
      await messaging.enviarGrupo(instance, remoteJid, texto);
      return;
    }
    await messaging.enviarDM(instance, autorJid, texto);
  }

  private isAdmin(autorJid: string): boolean {
    return sparkConfig.adminJids.includes(autorJid);
  }

  private formatMemberSummary(member: any): string {
    const trial = member.trialEndsAt
      ? member.trialEndsAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
      : 'n/d';
    const last = member.lastInteractionAt
      ? member.lastInteractionAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
      : 'n/d';

    return [
      `Spark member: ${member.jid}`,
      `segmento: ${member.segmento}`,
      `temChave: ${member.temChave ? 'sim' : 'nao'}`,
      `usageLevel: ${member.usageLevel}`,
      `trialEndsAt: ${trial}`,
      `lastInteractionAt: ${last}`,
      `pendingFlow: ${member.pendingFlow || 'nenhum'}`,
    ].join('\n');
  }

  private async handleAdminCommand(
    payload: EvolutionWebhookPayload,
    remoteJid: string,
    autorJid: string,
    texto: string
  ): Promise<boolean> {
    const normalized = this.normalize(texto);
    if (!this.isAdminCommand(normalized)) {
      return false;
    }

    if (!this.isAdmin(autorJid)) {
      await this.responderNoCanal(
        payload.instance,
        remoteJid,
        autorJid,
        'Comando Spark restrito a administradores autorizados.'
      );
      return true;
    }

    const raw = texto.trim().replace(/^\/?spark\s*/i, '');
    const parts = raw.split(/\s+/).filter(Boolean);
    const action = (parts[0] || 'help').toLowerCase();

    if (action === 'help') {
      await this.responderNoCanal(
        payload.instance,
        remoteJid,
        autorJid,
        [
          'Comandos Spark admin:',
          '/spark membro <jid>',
          '/spark usage <jid> <high|low|unknown>',
          '/spark chave <jid> <on|off>',
          '/spark trial <jid> <dias|iso>',
          '/spark run <challenge|answer|lifecycle>',
          '/spark reenviar <jid>',
        ].join('\n')
      );
      return true;
    }

    if (action === 'membro') {
      const jid = parts[1];
      if (!jid) {
        await this.responderNoCanal(payload.instance, remoteJid, autorJid, 'Uso: /spark membro <jid>');
        return true;
      }
      const member = await sparkMemberRepository.get(jid);
      await this.responderNoCanal(
        payload.instance,
        remoteJid,
        autorJid,
        member ? this.formatMemberSummary(member) : 'Membro Spark nao encontrado.'
      );
      return true;
    }

    if (action === 'usage') {
      const jid = parts[1];
      const usage = parts[2] as SparkUsageLevel | undefined;
      if (!jid || !usage || !['high', 'low', 'unknown'].includes(usage)) {
        await this.responderNoCanal(
          payload.instance,
          remoteJid,
          autorJid,
          'Uso: /spark usage <jid> <high|low|unknown>'
        );
        return true;
      }
      await sparkMemberRepository.setUsageLevel(jid, usage);
      await this.responderNoCanal(
        payload.instance,
        remoteJid,
        autorJid,
        `usageLevel de ${jid} atualizado para ${usage}.`
      );
      return true;
    }

    if (action === 'chave') {
      const jid = parts[1];
      const status = (parts[2] || '').toLowerCase();
      if (!jid || !['on', 'off'].includes(status)) {
        await this.responderNoCanal(
          payload.instance,
          remoteJid,
          autorJid,
          'Uso: /spark chave <jid> <on|off>'
        );
        return true;
      }
      await sparkMemberRepository.save(jid, { temChave: status === 'on' });
      await this.responderNoCanal(
        payload.instance,
        remoteJid,
        autorJid,
        `temChave de ${jid} atualizado para ${status === 'on' ? 'sim' : 'nao'}.`
      );
      return true;
    }

    if (action === 'trial') {
      const jid = parts[1];
      const value = parts[2];
      if (!jid || !value) {
        await this.responderNoCanal(
          payload.instance,
          remoteJid,
          autorJid,
          'Uso: /spark trial <jid> <dias|iso>'
        );
        return true;
      }

      let trialEndsAt: Date;
      if (/^\d+$/.test(value)) {
        trialEndsAt = new Date(Date.now() + Number(value) * 24 * 60 * 60 * 1000);
      } else {
        trialEndsAt = new Date(value);
      }

      if (isNaN(trialEndsAt.getTime())) {
        await this.responderNoCanal(
          payload.instance,
          remoteJid,
          autorJid,
          'Valor de trial invalido. Use dias inteiros ou data ISO.'
        );
        return true;
      }

      await sparkMemberRepository.save(jid, { trialEndsAt });
      await this.responderNoCanal(
        payload.instance,
        remoteJid,
        autorJid,
        `trialEndsAt de ${jid} ajustado para ${trialEndsAt.toISOString()}.`
      );
      return true;
    }

    if (action === 'run') {
      const target = (parts[1] || '').toLowerCase();
      if (target === 'challenge') {
        await this.sendWeeklyChallenge();
        await this.responderNoCanal(payload.instance, remoteJid, autorJid, 'Desafio semanal disparado.');
        return true;
      }
      if (target === 'answer') {
        await this.sendWeeklyAnswerAndBonus();
        await this.responderNoCanal(payload.instance, remoteJid, autorJid, 'Resposta semanal + bonus disparados.');
        return true;
      }
      if (target === 'lifecycle') {
        await this.runLifecycleChecks();
        await this.responderNoCanal(payload.instance, remoteJid, autorJid, 'Ciclo de vida Spark executado.');
        return true;
      }
      await this.responderNoCanal(
        payload.instance,
        remoteJid,
        autorJid,
        'Uso: /spark run <challenge|answer|lifecycle>'
      );
      return true;
    }

    if (action === 'reenviar') {
      const jid = parts[1];
      if (!jid) {
        await this.responderNoCanal(payload.instance, remoteJid, autorJid, 'Uso: /spark reenviar <jid>');
        return true;
      }
      const member = await sparkMemberRepository.get(jid);
      if (!member) {
        await this.responderNoCanal(payload.instance, remoteJid, autorJid, 'Membro Spark nao encontrado.');
        return true;
      }
      if (member.temChave) {
        await this.sendMainMenu(payload.instance, jid);
      } else {
        await this.sendKeyFlow(payload.instance, jid, member.segmento);
      }
      await this.responderNoCanal(payload.instance, remoteJid, autorJid, `Fluxo reenviado para ${jid}.`);
      return true;
    }

    await this.responderNoCanal(
      payload.instance,
      remoteJid,
      autorJid,
      'Comando Spark nao reconhecido. Use /spark help.'
    );
    return true;
  }

  private async handleKeyword(instance: string, autorJid: string, text: string): Promise<boolean> {
    const normalized = this.normalize(text);

    if (this.PLAN_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
      const suffix = sparkConfig.plansUrl ? `\n${sparkConfig.plansUrl}` : '';
      await messaging.enviarDM(instance, autorJid, `${sparkConfig.plansText}${suffix}`);
      return true;
    }

    if (this.KEY_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
      const member = await sparkMemberRepository.get(autorJid);
      if (!member) return false;
      await this.sendKeyFlow(instance, autorJid, member.segmento);
      return true;
    }

    if (this.SUPPORT_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
      await messaging.enviarDM(instance, autorJid, sparkConfig.helpText);
      return true;
    }

    return false;
  }

  private async handlePendingFlow(
    instance: string,
    autorJid: string,
    text: string
  ): Promise<boolean> {
    const member = await sparkMemberRepository.get(autorJid);
    if (!member?.pendingFlow) return false;

    if (member.pendingFlow === 'technical_question') {
      const cta = sparkConfig.appUrl ? `\n${sparkConfig.appUrl}` : '';
      await messaging.enviarDM(instance, autorJid, `${sparkConfig.appCtaText}${cta}`);
      await sparkMemberRepository.touchInteraction(autorJid);
      return true;
    }

    if (member.pendingFlow === 'low_usage_diagnosis') {
      const normalized = this.normalize(text);
      const seemsTechnical =
        normalized.includes('erro') ||
        normalized.includes('bug') ||
        normalized.includes('nao entendi') ||
        normalized.includes('nao consegui') ||
        normalized.includes('trav');

      await messaging.enviarDM(
        instance,
        autorJid,
        seemsTechnical ? sparkConfig.extensionText : sparkConfig.feedbackText
      );
      await sparkMemberRepository.touchInteraction(autorJid);
      return true;
    }

    return false;
  }

  public async shouldHandleDirectMessage(
    payload: EvolutionWebhookPayload,
    texto: string | null
  ): Promise<boolean> {
    if (!sparkConfig.enabled) return false;
    const remoteJid = payload.data?.key?.remoteJid;
    if (!remoteJid || this.isGroup(remoteJid)) return false;
    if (this.isSparkIntentText(texto)) return true;
    return !!(texto && (await sparkMemberRepository.get(remoteJid)));
  }

  async onMessage(payload: EvolutionWebhookPayload, texto: string | null): Promise<void> {
    if (!sparkConfig.enabled || !texto) return;

    const remoteJid = payload.data?.key?.remoteJid;
    const autorJid = payload.data?.key?.participant || remoteJid;
    if (!remoteJid || !autorJid) return;

    if (await this.handleAdminCommand(payload, remoteJid, autorJid, texto)) return;

    const pushName = payload.data?.pushName || '';
    const isSparkGroup = sparkConfig.groupJid && remoteJid === sparkConfig.groupJid;

    if (this.isGroup(remoteJid)) {
      if (!isSparkGroup) return;

      const member = await sparkMemberRepository.ensure(
        autorJid,
        pushName,
        this.computeSegment(autorJid),
        this.trialEndsAt(new Date())
      );
      await sparkMemberRepository.touchInteraction(autorJid, pushName);

      const handled = await this.handleKeyword(payload.instance, autorJid, texto);
      if (!handled) {
        const today = new Date().getDay();
        if (today === 2 || today === 3 || today === 4) {
          await sparkMemberRepository.markChallengeParticipation(autorJid, this.weekKey(new Date()));
        }
      }

      if (!member.temChave) {
        await this.sendKeyFlow(payload.instance, autorJid, member.segmento);
      }
      return;
    }

    const normalized = this.normalize(texto);
    const member = await this.ensureMember(autorJid, pushName);

    if (await this.handlePendingFlow(payload.instance, autorJid, texto)) return;
    if (await this.handleKeyword(payload.instance, autorJid, texto)) {
      await sparkMemberRepository.touchInteraction(autorJid, pushName);
      return;
    }

    if (this.isMenuShortcut(normalized)) {
      await sparkMemberRepository.touchInteraction(autorJid, pushName);
      await this.sendMainMenu(payload.instance, autorJid);
      return;
    }

    if (!member.temChave) {
      await this.sendKeyFlow(payload.instance, autorJid, member.segmento);
      await sparkMemberRepository.touchInteraction(autorJid, pushName);
      return;
    }

    await sparkMemberRepository.touchInteraction(autorJid, pushName);
    await this.sendMainMenu(payload.instance, autorJid);
  }

  async onParticipantUpdate(payload: EvolutionWebhookPayload): Promise<void> {
    if (!sparkConfig.enabled || payload.data?.action !== 'add') return;

    const remoteJid = payload.data?.id || payload.data?.key?.remoteJid || payload.data?.groupJid;
    const participants = payload.data?.participants || [];
    if (!remoteJid || remoteJid !== sparkConfig.groupJid || participants.length === 0) return;

    for (const jid of participants) {
      const member = await sparkMemberRepository.ensure(
        jid,
        payload.data?.pushName || '',
        this.computeSegment(jid),
        this.trialEndsAt(new Date())
      );

      const numero = jid.split('@')[0];
      await messaging.enviarGrupoComMencao(
        payload.instance,
        remoteJid,
        `@${numero} bem-vindo(a) ao Spark. Vou te mandar sua chave e o menu principal no privado agora.`,
        jid
      );

      if (member.temChave) {
        await this.sendMainMenu(payload.instance, jid);
      } else {
        await this.sendKeyFlow(payload.instance, jid, member.segmento);
      }
    }
  }

  async sendWeeklyChallenge(): Promise<void> {
    if (!sparkConfig.enabled || !sparkConfig.evolutionInstance || !sparkConfig.groupJid) return;
    await messaging.enviarGrupo(
      sparkConfig.evolutionInstance,
      sparkConfig.groupJid,
      sparkConfig.challengeText
    );
  }

  async sendWeeklyAnswerAndBonus(): Promise<void> {
    if (!sparkConfig.enabled || !sparkConfig.evolutionInstance || !sparkConfig.groupJid) return;

    const weekKey = this.weekKey(new Date());
    await messaging.enviarGrupo(
      sparkConfig.evolutionInstance,
      sparkConfig.groupJid,
      sparkConfig.challengeAnswerText
    );

    const participants = await sparkMemberRepository.listChallengeParticipants(weekKey);
    for (const member of participants) {
      if (member.lastBonusWeekSent === weekKey) continue;
      await messaging.enviarDM(
        sparkConfig.evolutionInstance,
        member.jid,
        sparkConfig.challengeBonusText
      );
      await sparkMemberRepository.markBonusSent(member.jid, weekKey);
    }
  }

  async runLifecycleChecks(agora: Date = new Date()): Promise<void> {
    if (!sparkConfig.enabled || !sparkConfig.evolutionInstance) return;

    const inactivityCutoff = new Date(
      agora.getTime() - sparkConfig.inactivityDays * 24 * 60 * 60 * 1000
    );
    const inativos = await sparkMemberRepository.listDueInactivity(inactivityCutoff);
    for (const member of inativos) {
      await messaging.enviarDM(
        sparkConfig.evolutionInstance,
        member.jid,
        sparkConfig.technicalQuestionText
      );
      await sparkMemberRepository.markInactivityPrompt(member.jid);
    }

    const windowStart = new Date(
      agora.getTime() + sparkConfig.expiryLeadDays * 24 * 60 * 60 * 1000 - 12 * 60 * 60 * 1000
    );
    const windowEnd = new Date(
      agora.getTime() + sparkConfig.expiryLeadDays * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000
    );
    const expirando = await sparkMemberRepository.listDueExpiry(windowStart, windowEnd);

    for (const member of expirando) {
      if (member.usageLevel === 'high') {
        const suffix = sparkConfig.plansUrl ? `\n${sparkConfig.plansUrl}` : '';
        await messaging.enviarDM(
          sparkConfig.evolutionInstance,
          member.jid,
          `${sparkConfig.upgradeText}${suffix}`
        );
        await sparkMemberRepository.markExpiryPrompt(member.jid, null);
        continue;
      }

      await messaging.enviarDM(
        sparkConfig.evolutionInstance,
        member.jid,
        sparkConfig.lowUsageDiagnosticText
      );
      await sparkMemberRepository.markExpiryPrompt(member.jid);
    }
  }
}

export default new SparkCommunityOrchestrator();
