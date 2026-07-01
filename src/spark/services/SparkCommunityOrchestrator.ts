import { EvolutionWebhookPayload } from '../../interfaces/evolution.interface';
import { sparkConfig } from '../config/sparkConfig';
import sparkAdminRepository from '../repositories/SparkAdminRepository';
import sparkChallengeRepository from '../repositories/SparkChallengeRepository';
import sparkMemberRepository from '../repositories/SparkMemberRepository';
import sparkSettingsRepository from '../repositories/SparkSettingsRepository';
import messaging from './SparkMessagingService';
import {
  SparkChallenge,
  SparkChallengeOption,
  SparkSegmento,
  SparkUsageLevel,
} from '../interfaces/spark.interface';

export interface SparkRunResult {
  sent: boolean;
  target?: string;
  reason?: string;
  bonusSent?: number;
  bonusSkipped?: number;
  challengeId?: string;
  answers?: number;
  correctAnswers?: number;
  inactivitySent?: number;
  expirySent?: number;
}

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
  private readonly MATERIAL_KEYWORDS = ['material', 'estudo', 'apostila', 'conteudo'];

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

  private generateKey(prefix: string): string {
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `${prefix}-${suffix}`;
  }

  private isYes(text: string): boolean {
    const normalized = this.normalize(text);
    return ['sim', 's', 'tenho', 'ja tenho', 'tenho sim'].includes(normalized);
  }

  private isNo(text: string): boolean {
    const normalized = this.normalize(text);
    return ['nao', 'não', 'n', 'nao tenho', 'não tenho'].includes(normalized);
  }

  private parseSegment(text: string): SparkSegmento | null {
    const normalized = this.normalize(text).replace(/[^abc]/g, '');
    if (normalized === 'a' || normalized === 'b' || normalized === 'c') return normalized.toUpperCase() as SparkSegmento;
    return null;
  }

  private parseChallengeOption(text: string): SparkChallengeOption | null {
    const normalized = this.normalize(text).trim();
    if (['a', 'b', 'c', 'd'].includes(normalized)) return normalized.toUpperCase() as SparkChallengeOption;
    return null;
  }

  private async sendKeyFlow(instance: string, jid: string, segmento: 'A' | 'B' | 'C'): Promise<void> {
    const code = this.generateKey('SPARK');
    await messaging.enviarDM(instance, jid, this.buildKeyText(segmento, code));
    await sparkMemberRepository.addGeneratedKey(jid, { type: 'trial', code, reason: 'trial' });
    await sparkMemberRepository.markKeyDelivered(jid);
  }

  private async sendKeyFlowNoCanal(
    instance: string,
    remoteJid: string,
    autorJid: string,
    segmento: 'A' | 'B' | 'C'
  ): Promise<void> {
    const code = this.generateKey('SPARK');
    await messaging.enviarGrupo(instance, remoteJid, this.buildKeyText(segmento, code));
    await sparkMemberRepository.addGeneratedKey(autorJid, { type: 'trial', code, reason: 'trial' });
    await sparkMemberRepository.markKeyDelivered(autorJid);
  }

  private buildKeyText(segmento: 'A' | 'B' | 'C', code = sparkConfig.defaultKey): string {
    const appUrl = sparkConfig.appUrl || 'spark.voltsmind.com.br';
    return [
      '🔑 Sua chave de acesso — *14 dias grátis:*',
      '',
      `\`${code}\``,
      '',
      'Como ativar:',
      `1. Baixe: ${appUrl}`,
      '2. Crie sua conta',
      '3. Configurações → *Ativar licença* → cole a chave',
      '',
      `Segmento: *${segmento}*`,
      'Qualquer dúvida, manda mensagem aqui. ⚡',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private buildWelcomeQuestion(numero?: string): string {
    const mention = numero ? `@${numero} ` : '';
    return [
      `${mention}⚡ Bem-vindo(a) à comunidade SPARK!`,
      '',
      'Aqui você pratica, aprende e domina proteção de sistemas elétricos com quem vive isso no dia a dia.',
      '',
      'Você já tem sua chave de acesso ao app?',
      '',
      'Responda *SIM* ou *NÃO*.',
    ].join('\n');
  }

  private buildSegmentQuestion(): string {
    return [
      'Me conta: você é...',
      '',
      '🎓 *A* — Estudante de engenharia',
      '🔧 *B* — Técnico ou profissional de proteção',
      '🏢 *C* — Empresa / uso corporativo',
    ].join('\n');
  }

  private buildMainMenu(): string {
    return [
      'O que você precisa?',
      '',
      '1️⃣ Minha chave de acesso',
      '2️⃣ Planos e preços',
      '3️⃣ Desafio técnico',
      '4️⃣ Falar com especialista',
      '5️⃣ Material de estudo',
    ].join('\n');
  }

  private buildPlansText(): string {
    return [
      '💳 *Planos SPARK:*',
      '',
      '🎓 *Student* — R$19,90/mês',
      'Para estudantes | Simulador + exercícios',
      '',
      '⚡ *Pro* — R$39,90/mês',
      'Para profissionais | + análise de curvas + relatórios',
      '',
      '🏆 *Premium* — R$79,90/mês',
      'Para equipes | + multi-usuário + suporte prioritário',
      '',
      '📅 Anual: *17% de desconto* em todos os planos',
      '',
      `👉 ${sparkConfig.plansUrl || 'spark.voltsmind.com.br/planos'}`,
    ].join('\n');
  }

  private buildMaterialText(): string {
    const appUrl = sparkConfig.appUrl || 'spark.voltsmind.com.br';
    return `📚 Material de estudo SPARK: acesse os exercícios e casos práticos em ${appUrl}`;
  }

  private buildChallengeText(challenge: SparkChallenge): string {
    return [
      `⚡ *Desafio da Semana #${challenge.number}*`,
      '',
      challenge.imageUrl ? `[imagem: ${challenge.imageUrl}]` : '',
      challenge.question,
      '',
      `*A* — ${challenge.options.A}`,
      `*B* — ${challenge.options.B}`,
      `*C* — ${challenge.options.C}`,
      `*D* — ${challenge.options.D}`,
      '',
      '🏆 Quem acertar recebe 7 dias extras no SPARK.',
      'Responde aqui: A, B, C ou D 👇',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private buildChallengeResultText(
    challenge: SparkChallenge,
    correctCount: number,
    firstCorrectName: string
  ): string {
    return [
      `📊 *Resultado do Desafio #${challenge.number}*`,
      '',
      `✅ Resposta certa: *${challenge.correctOption} — ${challenge.correctLabel}*`,
      '',
      challenge.explanation,
      '',
      `🏆 Acertaram: *${correctCount} membros*`,
      `⚡ Primeiro a responder: *${firstCorrectName || 'n/d'}*`,
      '',
      'Veja a análise completa no app 📲',
    ].join('\n');
  }

  private buildDefaultChallenge(weekKey: string, number: number): SparkChallenge {
    return {
      id: '',
      number,
      weekKey,
      status: 'draft',
      question: 'Qual o tipo de falta nesta curva?',
      options: {
        A: 'Monofásica-terra',
        B: 'Bifásica',
        C: 'Bifásica-terra',
        D: 'Trifásica',
      },
      correctOption: 'A',
      correctLabel: 'Monofásica-terra',
      explanation:
        'A corrente de uma fase cresce de forma predominante em relação às demais. Em campo, isso indica caminho de falta envolvendo fase e terra.',
    };
  }

  private async sendMainMenu(instance: string, jid: string): Promise<void> {
    await messaging.enviarDM(instance, jid, this.buildMainMenu());
  }

  private isMenuShortcut(text: string): boolean {
    return text === 'spark' || text === '/spark' || text === 'menu';
  }

  private isSparkIntentText(text: string | null): boolean {
    if (!text) return false;
    const normalized = this.normalize(text);

    return (
      this.isMenuShortcut(normalized) ||
      this.isAdminCommand(normalized) ||
      this.PLAN_KEYWORDS.some((keyword) => normalized.includes(keyword)) ||
      this.SUPPORT_KEYWORDS.some((keyword) => normalized.includes(keyword)) ||
      this.KEY_KEYWORDS.some((keyword) => normalized.includes(keyword)) ||
      this.MATERIAL_KEYWORDS.some((keyword) => normalized.includes(keyword))
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

  private async isAdmin(autorJid: string): Promise<boolean> {
    return sparkAdminRepository.isAdmin(autorJid);
  }

  private async getRuntimeSettings() {
    return sparkSettingsRepository.get();
  }

  private async getSparkGroupJid(): Promise<string> {
    const settings = await this.getRuntimeSettings();
    return settings.groupJid;
  }

  private async isDmEnabled(): Promise<boolean> {
    const settings = await this.getRuntimeSettings();
    return settings.dmEnabled;
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

    if (!(await this.isAdmin(autorJid))) {
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
        const result = await this.sendWeeklyChallenge();
        await this.responderNoCanal(
          payload.instance,
          remoteJid,
          autorJid,
          result.sent ? 'Desafio semanal disparado.' : `Desafio semanal nao disparado: ${result.reason || 'motivo desconhecido'}.`
        );
        return true;
      }
      if (target === 'answer') {
        const result = await this.sendWeeklyAnswerAndBonus();
        await this.responderNoCanal(
          payload.instance,
          remoteJid,
          autorJid,
          result.sent
            ? `Resposta semanal disparada. Bonus enviados: ${result.bonusSent || 0}.`
            : `Resposta semanal nao disparada: ${result.reason || 'motivo desconhecido'}.`
        );
        return true;
      }
      if (target === 'lifecycle') {
        const result = await this.runLifecycleChecks();
        await this.responderNoCanal(
          payload.instance,
          remoteJid,
          autorJid,
          result.sent
            ? `Ciclo de vida Spark executado. D+3: ${result.inactivitySent || 0}; D+10: ${result.expirySent || 0}.`
            : `Ciclo de vida nao executado: ${result.reason || 'motivo desconhecido'}.`
        );
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

  private async handleKeyword(
    instance: string,
    remoteJid: string,
    autorJid: string,
    text: string
  ): Promise<boolean> {
    const normalized = this.normalize(text);

    if (normalized === '2' || this.PLAN_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
      await this.responderNoCanal(instance, remoteJid, autorJid, this.buildPlansText());
      return true;
    }

    if (normalized === '1' || this.KEY_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
      const member = await sparkMemberRepository.get(autorJid);
      if (!member) return false;
      if (this.isGroup(remoteJid)) {
        await this.sendKeyFlowNoCanal(instance, remoteJid, autorJid, member.segmento);
      } else {
        await this.sendKeyFlow(instance, autorJid, member.segmento);
      }
      return true;
    }

    if (normalized === '3' || normalized.includes('desafio')) {
      const active = await sparkChallengeRepository.findByWeekAndStatus(this.weekKey(new Date()), 'open');
      await this.responderNoCanal(
        instance,
        remoteJid,
        autorJid,
        active
          ? this.buildChallengeText(active)
          : 'Ainda nao ha desafio aberto nesta semana. Fica de olho: toda terca tem desafio novo. ⚡'
      );
      return true;
    }

    if (normalized === '4' || this.SUPPORT_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
      await this.responderNoCanal(instance, remoteJid, autorJid, sparkConfig.helpText);
      return true;
    }

    if (normalized === '5' || this.MATERIAL_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
      await this.responderNoCanal(instance, remoteJid, autorJid, this.buildMaterialText());
      return true;
    }

    return false;
  }

  private async handlePendingFlow(
    instance: string,
    remoteJid: string,
    autorJid: string,
    text: string
  ): Promise<boolean> {
    const member = await sparkMemberRepository.get(autorJid);
    if (!member?.pendingFlow) return false;

    if (member.pendingFlow === 'ask_existing_key') {
      if (this.isYes(text)) {
        await sparkMemberRepository.save(autorJid, {
          hasExistingKey: true,
          temChave: true,
          pendingFlow: null,
        });
        await this.responderNoCanal(instance, remoteJid, autorJid, this.buildMainMenu());
        await sparkMemberRepository.markMenuSent(autorJid);
        return true;
      }

      if (this.isNo(text)) {
        await sparkMemberRepository.save(autorJid, {
          hasExistingKey: false,
          pendingFlow: 'ask_segment',
        });
        setTimeout(() => {
          this.responderNoCanal(instance, remoteJid, autorJid, this.buildSegmentQuestion()).catch((error) =>
            console.error('❌ [Spark] Falha ao enviar segmentacao:', error)
          );
        }, 3000);
        return true;
      }

      await this.responderNoCanal(instance, remoteJid, autorJid, 'Responde com *SIM* ou *NÃO* pra eu seguir. ⚡');
      return true;
    }

    if (member.pendingFlow === 'ask_segment') {
      const segmento = this.parseSegment(text);
      if (!segmento) {
        await this.responderNoCanal(instance, remoteJid, autorJid, this.buildSegmentQuestion());
        return true;
      }

      await sparkMemberRepository.save(autorJid, {
        segmento,
        pendingFlow: null,
      });

      if (segmento === 'C') {
        await this.responderNoCanal(
          instance,
          remoteJid,
          autorJid,
          'Perfeito! Um especialista vai entrar em contato em breve. 👍'
        );
        return true;
      }

      if (this.isGroup(remoteJid)) {
        await this.sendKeyFlowNoCanal(instance, remoteJid, autorJid, segmento);
      } else {
        await this.sendKeyFlow(instance, autorJid, segmento);
      }
      return true;
    }

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
    if (!(await this.isDmEnabled())) return false;
    const remoteJid = payload.data?.key?.remoteJid;
    if (!remoteJid || this.isGroup(remoteJid)) return false;
    if (this.isSparkIntentText(texto)) return true;
    return !!(texto && (await sparkMemberRepository.get(remoteJid)));
  }

  private async handleChallengeAnswer(
    instance: string,
    remoteJid: string,
    autorJid: string,
    pushName: string,
    text: string
  ): Promise<boolean> {
    if (!this.isGroup(remoteJid)) return false;
    const option = this.parseChallengeOption(text);
    if (!option) return false;

    const challenge = await sparkChallengeRepository.findByWeekAndStatus(this.weekKey(new Date()), 'open');
    if (!challenge) return false;

    const { created } = await sparkChallengeRepository.recordAnswer({
      challenge,
      memberJid: autorJid,
      pushName,
      option,
    });

    if (created) {
      await sparkMemberRepository.markChallengeParticipation(autorJid, challenge.weekKey);
    }

    return true;
  }

  async onMessage(payload: EvolutionWebhookPayload, texto: string | null): Promise<void> {
    if (!sparkConfig.enabled || !texto) return;

    const remoteJid = payload.data?.key?.remoteJid;
    const autorJid = payload.data?.key?.participant || remoteJid;
    if (!remoteJid || !autorJid) return;
    const settings = await this.getRuntimeSettings();
    if (!this.isGroup(remoteJid) && !settings.dmEnabled) return;

    if (await this.handleAdminCommand(payload, remoteJid, autorJid, texto)) return;

    const pushName = payload.data?.pushName || '';
    const isSparkGroup = settings.groupJid && remoteJid === settings.groupJid;

    if (this.isGroup(remoteJid)) {
      if (!isSparkGroup) return;

      let member = await sparkMemberRepository.ensure(
        autorJid,
        pushName,
        this.computeSegment(autorJid),
        this.trialEndsAt(new Date())
      );
      await sparkMemberRepository.touchInteraction(autorJid, pushName);

      if (!member.pendingFlow && !member.temChave && member.hasExistingKey === undefined) {
        await sparkMemberRepository.save(autorJid, { pendingFlow: 'ask_existing_key' });
        await messaging.enviarGrupoComMencao(
          payload.instance,
          remoteJid,
          this.buildWelcomeQuestion(autorJid.split('@')[0]),
          autorJid
        );
        return;
      }

      member = (await sparkMemberRepository.get(autorJid)) || member;
      if (await this.handlePendingFlow(payload.instance, remoteJid, autorJid, texto)) return;

      if (this.isMenuShortcut(this.normalize(texto))) {
        await messaging.enviarGrupo(payload.instance, remoteJid, this.buildMainMenu());
        await sparkMemberRepository.markMenuSent(autorJid);
        return;
      }

      const handled = await this.handleKeyword(payload.instance, remoteJid, autorJid, texto);
      if (handled) {
        return;
      }

      if (await this.handleChallengeAnswer(payload.instance, remoteJid, autorJid, pushName, texto)) {
        return;
      }

      await messaging.enviarGrupo(payload.instance, remoteJid, this.buildMainMenu());
      await sparkMemberRepository.markMenuSent(autorJid);
      return;
    }

    const normalized = this.normalize(texto);
    const member = await this.ensureMember(autorJid, pushName);

    if (await this.handlePendingFlow(payload.instance, remoteJid, autorJid, texto)) return;
    if (await this.handleKeyword(payload.instance, remoteJid, autorJid, texto)) {
      await sparkMemberRepository.touchInteraction(autorJid, pushName);
      return;
    }

    if (this.isMenuShortcut(normalized)) {
      await sparkMemberRepository.touchInteraction(autorJid, pushName);
      await this.sendMainMenu(payload.instance, autorJid);
      await sparkMemberRepository.markMenuSent(autorJid);
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
    const settings = await this.getRuntimeSettings();
    if (!remoteJid || remoteJid !== settings.groupJid || participants.length === 0) return;

    for (const jid of participants) {
      await sparkMemberRepository.ensure(
        jid,
        payload.data?.pushName || '',
        this.computeSegment(jid),
        this.trialEndsAt(new Date())
      );
      await sparkMemberRepository.save(jid, { pendingFlow: 'ask_existing_key' });

      const numero = jid.split('@')[0];
      await messaging.enviarGrupoComMencao(
        payload.instance,
        remoteJid,
        this.buildWelcomeQuestion(numero),
        jid
      );
    }
  }

  async sendWeeklyChallenge(): Promise<SparkRunResult> {
    const groupJid = await this.getSparkGroupJid();
    if (!sparkConfig.enabled) return { sent: false, reason: 'Spark desativado' };
    if (!sparkConfig.evolutionInstance) return { sent: false, reason: 'EVOLUTION_INSTANCE nao configurado' };
    if (!groupJid) return { sent: false, reason: 'Grupo Spark nao configurado' };

    const weekKey = this.weekKey(new Date());
    let challenge =
      (await sparkChallengeRepository.findByWeekAndStatus(weekKey, 'open')) ||
      (await sparkChallengeRepository.findByWeekAndStatus(weekKey, 'draft'));

    if (!challenge) {
      challenge = await sparkChallengeRepository.upsert(
        this.buildDefaultChallenge(weekKey, await sparkChallengeRepository.nextNumber())
      );
    }

    challenge = (await sparkChallengeRepository.publish(challenge.id)) || challenge;
    const text = this.buildChallengeText(challenge);

    if (challenge.imageUrl) {
      await messaging.enviarImagemGrupo(sparkConfig.evolutionInstance, groupJid, challenge.imageUrl, text);
    } else {
      await messaging.enviarGrupo(sparkConfig.evolutionInstance, groupJid, text);
    }

    return { sent: true, target: groupJid, challengeId: challenge.id };
  }

  async sendWeeklyAnswerAndBonus(challengeId?: string): Promise<SparkRunResult> {
    const settings = await this.getRuntimeSettings();
    if (!sparkConfig.enabled) return { sent: false, reason: 'Spark desativado' };
    if (!sparkConfig.evolutionInstance) return { sent: false, reason: 'EVOLUTION_INSTANCE nao configurado' };
    if (!settings.groupJid) return { sent: false, reason: 'Grupo Spark nao configurado' };

    const weekKey = this.weekKey(new Date());
    const challenge = challengeId
      ? await sparkChallengeRepository.get(challengeId)
      : await sparkChallengeRepository.findByWeekAndStatus(weekKey, 'open');
    if (!challenge) return { sent: false, reason: 'Nenhum desafio aberto nesta semana' };

    const answers = await sparkChallengeRepository.listAnswers(challenge.id);
    const correctAnswers = answers.filter((answer) => answer.correct);
    const firstCorrect = correctAnswers[0];
    let bonusSent = 0;
    let bonusSkipped = 0;

    for (const answer of correctAnswers) {
      if (answer.bonusKey) {
        bonusSkipped += 1;
        continue;
      }
      const code = this.generateKey('SPARK-BONUS');
      await sparkChallengeRepository.markBonus(answer.id, code);
      await sparkMemberRepository.addGeneratedKey(answer.memberJid, {
        type: 'bonus',
        code,
        reason: `challenge:${challenge.id}`,
        challengeId: challenge.id,
      });
      await sparkMemberRepository.markBonusSent(answer.memberJid, weekKey);
      bonusSent += 1;
    }

    await messaging.enviarGrupo(
      sparkConfig.evolutionInstance,
      settings.groupJid,
      this.buildChallengeResultText(challenge, correctAnswers.length, firstCorrect?.pushName || '')
    );
    await sparkChallengeRepository.markAnswered(challenge.id);

    return {
      sent: true,
      target: settings.groupJid,
      challengeId: challenge.id,
      answers: answers.length,
      correctAnswers: correctAnswers.length,
      bonusSent,
      bonusSkipped,
      reason: 'Bonus gerados e registrados; envio por DM fica desativado no v1',
    };
  }

  async runLifecycleChecks(agora: Date = new Date()): Promise<SparkRunResult> {
    if (!sparkConfig.enabled) return { sent: false, reason: 'Spark desativado' };
    if (!sparkConfig.evolutionInstance) return { sent: false, reason: 'EVOLUTION_INSTANCE nao configurado' };
    if (!(await this.isDmEnabled())) return { sent: false, reason: 'DM desativada no painel' };

    const inactivityCutoff = new Date(
      agora.getTime() - sparkConfig.inactivityDays * 24 * 60 * 60 * 1000
    );
    const inativos = await sparkMemberRepository.listDueInactivity(inactivityCutoff);
    let inactivitySent = 0;
    for (const member of inativos) {
      await messaging.enviarDM(
        sparkConfig.evolutionInstance,
        member.jid,
        sparkConfig.technicalQuestionText
      );
      await sparkMemberRepository.markInactivityPrompt(member.jid);
      inactivitySent += 1;
    }

    const windowStart = new Date(
      agora.getTime() + sparkConfig.expiryLeadDays * 24 * 60 * 60 * 1000 - 12 * 60 * 60 * 1000
    );
    const windowEnd = new Date(
      agora.getTime() + sparkConfig.expiryLeadDays * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000
    );
    const expirando = await sparkMemberRepository.listDueExpiry(windowStart, windowEnd);

    let expirySent = 0;
    for (const member of expirando) {
      if (member.usageLevel === 'high') {
        const suffix = sparkConfig.plansUrl ? `\n${sparkConfig.plansUrl}` : '';
        await messaging.enviarDM(
          sparkConfig.evolutionInstance,
          member.jid,
          `${sparkConfig.upgradeText}${suffix}`
        );
        await sparkMemberRepository.markExpiryPrompt(member.jid, null);
        expirySent += 1;
        continue;
      }

      await messaging.enviarDM(
        sparkConfig.evolutionInstance,
        member.jid,
        sparkConfig.lowUsageDiagnosticText
      );
      await sparkMemberRepository.markExpiryPrompt(member.jid);
      expirySent += 1;
    }

    return { sent: true, inactivitySent, expirySent };
  }
}

export default new SparkCommunityOrchestrator();
