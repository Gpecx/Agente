import { Request, Response } from 'express';
import { sparkConfig } from '../config/sparkConfig';
import sparkAdminRepository from '../repositories/SparkAdminRepository';
import sparkChallengeRepository from '../repositories/SparkChallengeRepository';
import sparkMemberRepository from '../repositories/SparkMemberRepository';
import sparkSettingsRepository from '../repositories/SparkSettingsRepository';
import sparkCommunityOrchestrator from '../services/SparkCommunityOrchestrator';
import { SparkChallengeOption, SparkSegmento, SparkUsageLevel } from '../interfaces/spark.interface';

const SEGMENTOS_VALIDOS: SparkSegmento[] = ['A', 'B', 'C'];
const USAGE_VALIDOS: SparkUsageLevel[] = ['unknown', 'high', 'low'];

class SparkAdminController {
  public getConfig = async (_req: Request, res: Response): Promise<void> => {
    try {
      const settings = await sparkSettingsRepository.get();
      res.status(200).json({
        enabled: sparkConfig.enabled,
        dmEnabled: settings.dmEnabled,
        groupJid: settings.groupJid,
        envDmEnabled: sparkConfig.dmEnabled,
        envGroupJid: sparkConfig.groupJid,
        evolutionInstance: sparkConfig.evolutionInstance,
        admins: await sparkAdminRepository.list(),
      });
    } catch (error) {
      console.error('❌ [SparkAdminController] Erro ao buscar config Spark:', error);
      res.status(500).json({ error: 'Erro interno ao buscar config Spark.' });
    }
  };

  public updateConfig = async (req: Request, res: Response): Promise<void> => {
    const { dmEnabled, groupJid } = req.body as {
      dmEnabled?: boolean;
      groupJid?: string;
    };

    const patch: { dmEnabled?: boolean; groupJid?: string } = {};

    if (dmEnabled !== undefined) {
      if (typeof dmEnabled !== 'boolean') {
        res.status(400).json({ error: 'dmEnabled deve ser boolean.' });
        return;
      }
      patch.dmEnabled = dmEnabled;
    }

    if (groupJid !== undefined) {
      const cleanGroupJid = groupJid.trim();
      if (cleanGroupJid && !cleanGroupJid.endsWith('@g.us')) {
        res.status(400).json({ error: 'groupJid deve terminar com @g.us ou ficar vazio.' });
        return;
      }
      patch.groupJid = cleanGroupJid;
    }

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: 'Informe dmEnabled e/ou groupJid para atualizar.' });
      return;
    }

    try {
      const settings = await sparkSettingsRepository.update(patch);
      res.status(200).json({
        message: 'Config Spark atualizada.',
        settings,
      });
    } catch (error) {
      console.error('❌ [SparkAdminController] Erro ao atualizar config Spark:', error);
      res.status(500).json({ error: 'Erro interno ao atualizar config Spark.' });
    }
  };

  public listAdmins = async (_req: Request, res: Response): Promise<void> => {
    try {
      const admins = await sparkAdminRepository.list();
      res.status(200).json({ count: admins.length, admins });
    } catch (error) {
      console.error('❌ [SparkAdminController] Erro ao listar admins Spark:', error);
      res.status(500).json({ error: 'Erro interno ao listar admins Spark.' });
    }
  };

  public addAdmin = async (req: Request, res: Response): Promise<void> => {
    const { jid } = req.body as { jid?: string };
    const cleanJid = jid?.trim();

    if (!cleanJid || !cleanJid.includes('@')) {
      res.status(400).json({ error: 'jid obrigatório. Ex.: 5511999999999@s.whatsapp.net ou ...@lid.' });
      return;
    }

    try {
      await sparkAdminRepository.add(cleanJid);
      res.status(200).json({ message: `Admin Spark ${cleanJid} autorizado.`, jid: cleanJid });
    } catch (error) {
      console.error('❌ [SparkAdminController] Erro ao adicionar admin Spark:', error);
      res.status(500).json({ error: 'Erro interno ao adicionar admin Spark.' });
    }
  };

  public removeAdmin = async (req: Request, res: Response): Promise<void> => {
    const { jid } = req.params;
    if (!jid) {
      res.status(400).json({ error: 'Parâmetro jid é obrigatório.' });
      return;
    }

    try {
      await sparkAdminRepository.remove(jid);
      res.status(200).json({ message: `Admin Spark ${jid} removido.` });
    } catch (error) {
      console.error('❌ [SparkAdminController] Erro ao remover admin Spark:', error);
      res.status(500).json({ error: 'Erro interno ao remover admin Spark.' });
    }
  };

  public listMembers = async (req: Request, res: Response): Promise<void> => {
    const limitRaw = Number(req.query.limit || 100);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 500)) : 100;

    try {
      const members = await sparkMemberRepository.list(limit);
      res.status(200).json({
        count: members.length,
        members: members.map((member) => this.serialize(member)),
      });
    } catch (error) {
      console.error('❌ [SparkAdminController] Erro ao listar membros Spark:', error);
      res.status(500).json({ error: 'Erro interno ao listar membros Spark.' });
    }
  };

  public getMember = async (req: Request, res: Response): Promise<void> => {
    const { jid } = req.params;
    if (!jid) {
      res.status(400).json({ error: 'Parâmetro jid é obrigatório.' });
      return;
    }

    try {
      const member = await sparkMemberRepository.get(jid);
      if (!member) {
        res.status(404).json({ error: 'Membro Spark não encontrado.' });
        return;
      }
      res.status(200).json(this.serialize(member));
    } catch (error) {
      console.error('❌ [SparkAdminController] Erro ao consultar membro Spark:', error);
      res.status(500).json({ error: 'Erro interno ao consultar membro Spark.' });
    }
  };

  public updateMember = async (req: Request, res: Response): Promise<void> => {
    const { jid } = req.params;
    const { segmento, usageLevel, temChave, hasExistingKey, appUsageCount, trialEndsAt, pendingFlow } = req.body as {
      segmento?: SparkSegmento;
      usageLevel?: SparkUsageLevel;
      temChave?: boolean;
      hasExistingKey?: boolean;
      appUsageCount?: number;
      trialEndsAt?: string;
      pendingFlow?: 'ask_existing_key' | 'ask_segment' | 'technical_question' | 'low_usage_diagnosis' | null;
    };

    if (!jid) {
      res.status(400).json({ error: 'Parâmetro jid é obrigatório.' });
      return;
    }

    const existente = await sparkMemberRepository.get(jid);
    if (!existente) {
      res.status(404).json({ error: 'Membro Spark não encontrado.' });
      return;
    }

    const patch: Record<string, any> = {};

    if (segmento !== undefined) {
      if (!SEGMENTOS_VALIDOS.includes(segmento)) {
        res.status(400).json({ error: `segmento inválido. Use: ${SEGMENTOS_VALIDOS.join(', ')}` });
        return;
      }
      patch.segmento = segmento;
    }

    if (usageLevel !== undefined) {
      if (!USAGE_VALIDOS.includes(usageLevel)) {
        res.status(400).json({ error: `usageLevel inválido. Use: ${USAGE_VALIDOS.join(', ')}` });
        return;
      }
      patch.usageLevel = usageLevel;
    }

    if (temChave !== undefined) {
      patch.temChave = !!temChave;
    }

    if (hasExistingKey !== undefined) {
      patch.hasExistingKey = !!hasExistingKey;
    }

    if (appUsageCount !== undefined) {
      const usageCount = Number(appUsageCount);
      if (!Number.isFinite(usageCount) || usageCount < 0) {
        res.status(400).json({ error: 'appUsageCount deve ser um número maior ou igual a zero.' });
        return;
      }
      patch.appUsageCount = Math.floor(usageCount);
    }

    if (pendingFlow !== undefined) {
      if (
        pendingFlow !== null &&
        pendingFlow !== 'ask_existing_key' &&
        pendingFlow !== 'ask_segment' &&
        pendingFlow !== 'technical_question' &&
        pendingFlow !== 'low_usage_diagnosis'
      ) {
        res.status(400).json({ error: 'pendingFlow inválido.' });
        return;
      }
      patch.pendingFlow = pendingFlow;
    }

    if (trialEndsAt !== undefined) {
      const parsed = new Date(trialEndsAt);
      if (isNaN(parsed.getTime())) {
        res.status(400).json({ error: 'trialEndsAt inválido. Use ISO 8601.' });
        return;
      }
      patch.trialEndsAt = parsed;
    }

    if (Object.keys(patch).length === 0) {
      res.status(400).json({
        error:
          'Informe ao menos um campo para atualização: segmento, usageLevel, temChave, hasExistingKey, appUsageCount, trialEndsAt, pendingFlow.',
      });
      return;
    }

    try {
      await sparkMemberRepository.save(jid, patch);
      const atualizado = await sparkMemberRepository.get(jid);
      res.status(200).json({
        message: 'Membro Spark atualizado.',
        member: atualizado ? this.serialize(atualizado) : null,
      });
    } catch (error) {
      console.error('❌ [SparkAdminController] Erro ao atualizar membro Spark:', error);
      res.status(500).json({ error: 'Erro interno ao atualizar membro Spark.' });
    }
  };

  public setMemberUsage = async (req: Request, res: Response): Promise<void> => {
    const { jid } = req.params;
    const usageCount = Number(req.body?.appUsageCount);

    if (!jid || !Number.isFinite(usageCount) || usageCount < 0) {
      res.status(400).json({ error: 'Informe jid e appUsageCount >= 0.' });
      return;
    }

    try {
      await sparkMemberRepository.setAppUsageCount(jid, usageCount);
      const member = await sparkMemberRepository.get(jid);
      res.status(200).json({ message: 'Uso do app atualizado.', member: member ? this.serialize(member) : null });
    } catch (error) {
      console.error('❌ [SparkAdminController] Erro ao atualizar uso Spark:', error);
      res.status(500).json({ error: 'Erro interno ao atualizar uso do app.' });
    }
  };

  public listChallenges = async (_req: Request, res: Response): Promise<void> => {
    try {
      const challenges = await sparkChallengeRepository.list(50);
      res.status(200).json({ count: challenges.length, challenges });
    } catch (error) {
      console.error('❌ [SparkAdminController] Erro ao listar desafios:', error);
      res.status(500).json({ error: 'Erro interno ao listar desafios.' });
    }
  };

  public getActiveChallenge = async (_req: Request, res: Response): Promise<void> => {
    try {
      const weekKey = this.weekKey(new Date());
      const challenge = await sparkChallengeRepository.findByWeekAndStatus(weekKey, 'open');
      res.status(200).json({ challenge });
    } catch (error) {
      console.error('❌ [SparkAdminController] Erro ao buscar desafio ativo:', error);
      res.status(500).json({ error: 'Erro interno ao buscar desafio ativo.' });
    }
  };

  public upsertChallenge = async (req: Request, res: Response): Promise<void> => {
    const body = req.body || {};
    const correctOption = String(body.correctOption || '').toUpperCase() as SparkChallengeOption;
    const options = body.options || {};

    if (!body.weekKey || !body.question || !['A', 'B', 'C', 'D'].includes(correctOption)) {
      res.status(400).json({ error: 'Informe weekKey, question e correctOption A/B/C/D.' });
      return;
    }

    for (const option of ['A', 'B', 'C', 'D'] as SparkChallengeOption[]) {
      if (typeof options[option] !== 'string' || !options[option].trim()) {
        res.status(400).json({ error: `Informe options.${option}.` });
        return;
      }
    }

    try {
      const challenge = await sparkChallengeRepository.upsert({
        id: typeof body.id === 'string' && body.id.trim() ? body.id.trim() : undefined,
        number: Number.isFinite(Number(body.number)) ? Number(body.number) : undefined,
        weekKey: String(body.weekKey).trim(),
        status: body.status,
        question: String(body.question).trim(),
        imageUrl: typeof body.imageUrl === 'string' ? body.imageUrl.trim() : undefined,
        options,
        correctOption,
        correctLabel: String(body.correctLabel || options[correctOption]).trim(),
        explanation: String(body.explanation || '').trim(),
      });
      res.status(200).json({ message: 'Desafio Spark salvo.', challenge });
    } catch (error) {
      console.error('❌ [SparkAdminController] Erro ao salvar desafio:', error);
      res.status(500).json({ error: 'Erro interno ao salvar desafio.' });
    }
  };

  public publishChallenge = async (req: Request, res: Response): Promise<void> => {
    try {
      const challenge = await sparkChallengeRepository.publish(req.params.id);
      res.status(200).json({ message: 'Desafio marcado como aberto.', challenge });
    } catch (error) {
      console.error('❌ [SparkAdminController] Erro ao publicar desafio:', error);
      res.status(500).json({ error: 'Erro interno ao publicar desafio.' });
    }
  };

  public publishChallengeAnswer = async (req: Request, res: Response): Promise<void> => {
    try {
      const challenge = await sparkChallengeRepository.get(req.params.id);
      if (!challenge) {
        res.status(404).json({ error: 'Desafio não encontrado.' });
        return;
      }
      const result = await sparkCommunityOrchestrator.sendWeeklyAnswerAndBonus(req.params.id);
      res.status(200).json({ message: 'Resultado do desafio processado.', result });
    } catch (error) {
      console.error('❌ [SparkAdminController] Erro ao publicar resposta do desafio:', error);
      res.status(500).json({ error: 'Erro interno ao publicar resposta do desafio.' });
    }
  };

  public listChallengeAnswers = async (req: Request, res: Response): Promise<void> => {
    try {
      const answers = await sparkChallengeRepository.listAnswers(req.params.id);
      res.status(200).json({
        count: answers.length,
        correct: answers.filter((answer) => answer.correct).length,
        answers,
      });
    } catch (error) {
      console.error('❌ [SparkAdminController] Erro ao listar respostas:', error);
      res.status(500).json({ error: 'Erro interno ao listar respostas.' });
    }
  };

  public runChallengeNow = async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await sparkCommunityOrchestrator.sendWeeklyChallenge();
      res.status(200).json({
        message: result.sent ? 'Desafio semanal Spark disparado.' : 'Desafio semanal Spark nao disparado.',
        result,
      });
    } catch (error) {
      console.error('❌ [SparkAdminController] Erro ao disparar desafio Spark:', error);
      res.status(500).json({ error: 'Erro interno ao disparar o desafio Spark.' });
    }
  };

  public runChallengeAnswerNow = async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await sparkCommunityOrchestrator.sendWeeklyAnswerAndBonus();
      res.status(200).json({
        message: result.sent ? 'Resposta semanal Spark disparada.' : 'Resposta semanal Spark nao disparada.',
        result,
      });
    } catch (error) {
      console.error('❌ [SparkAdminController] Erro ao disparar resposta do desafio Spark:', error);
      res.status(500).json({ error: 'Erro interno ao disparar a resposta do desafio Spark.' });
    }
  };

  public runLifecycleNow = async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await sparkCommunityOrchestrator.runLifecycleChecks();
      res.status(200).json({
        message: result.sent ? 'Ciclo de vida Spark executado manualmente.' : 'Ciclo de vida Spark nao executado.',
        result,
      });
    } catch (error) {
      console.error('❌ [SparkAdminController] Erro ao executar ciclo de vida Spark:', error);
      res.status(500).json({ error: 'Erro interno ao executar o ciclo de vida Spark.' });
    }
  };

  private serialize(member: any): Record<string, any> {
    return {
      ...member,
      chaveEntregueEm: member.chaveEntregueEm?.toISOString(),
      joinedAt: member.joinedAt?.toISOString(),
      lastInteractionAt: member.lastInteractionAt?.toISOString(),
      lastMenuAt: member.lastMenuAt?.toISOString(),
      lastChallengeAnswerAt: member.lastChallengeAnswerAt?.toISOString(),
      trialEndsAt: member.trialEndsAt?.toISOString(),
      lastInactivityPromptAt: member.lastInactivityPromptAt?.toISOString(),
      lastExpiryPromptAt: member.lastExpiryPromptAt?.toISOString(),
      generatedKeys: Array.isArray(member.generatedKeys)
        ? member.generatedKeys.map((key: any) => ({
            ...key,
            createdAt: key.createdAt?.toISOString(),
          }))
        : [],
    };
  }

  private weekKey(date: Date): string {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
  }
}

export default new SparkAdminController();
