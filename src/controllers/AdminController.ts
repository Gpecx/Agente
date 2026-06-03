import { Request, Response } from 'express';
import strikeRepository from '../repositories/StrikeRepository';
import promptRepository from '../repositories/PromptRepository';
import triagemConfigRepository from '../triagem/repositories/TriagemConfigRepository';
import triagemCandidateRepository from '../triagem/repositories/TriagemCandidateRepository';
import conversationSummaryService from '../services/ConversationSummaryService';

/**
 * Controller para operações administrativas do sistema de moderação.
 * Protegido por autenticação via ADMIN_API_KEY no header.
 */
class AdminController {
  /**
   * GET /admin/strikes/:remoteJid/:participantJid
   * Consulta o registro de strikes de um usuário em um grupo.
   */
  public getStrikes = async (req: Request, res: Response): Promise<void> => {
    const { remoteJid, participantJid } = req.params;

    if (!remoteJid || !participantJid) {
      res.status(400).json({ error: 'Parâmetros remoteJid e participantJid são obrigatórios.' });
      return;
    }

    try {
      const record = await strikeRepository.getRecord(remoteJid, participantJid);

      if (!record) {
        res.status(404).json({ message: 'Nenhum registro encontrado para este usuário.' });
        return;
      }

      res.status(200).json({
        remoteJid,
        participantJid,
        strikeCount: record.strikeCount,
        lastInfraction: record.lastInfraction,
      });
    } catch (error) {
      console.error('❌ [AdminController] Erro ao consultar strikes:', error);
      res.status(500).json({ error: 'Erro interno ao consultar o banco de dados.' });
    }
  };

  /**
   * DELETE /admin/strikes/:remoteJid/:participantJid
   * Zera os strikes de um usuário (anistia/perdão).
   */
  public resetStrikes = async (req: Request, res: Response): Promise<void> => {
    const { remoteJid, participantJid } = req.params;

    if (!remoteJid || !participantJid) {
      res.status(400).json({ error: 'Parâmetros remoteJid e participantJid são obrigatórios.' });
      return;
    }

    try {
      await strikeRepository.resetStrikes(remoteJid, participantJid);
      res.status(200).json({
        message: `Strikes do usuário ${participantJid} no grupo ${remoteJid} foram zerados com sucesso.`,
      });
    } catch (error) {
      console.error('❌ [AdminController] Erro ao resetar strikes:', error);
      res.status(500).json({ error: 'Erro interno ao resetar strikes.' });
    }
  };

  // ─── Prompt Management ─────────────────────────────────────────────────────

  /**
   * GET /admin/prompt
   * Retorna o prompt comportamental atual do Gemini.
   */
  public getPrompt = async (_req: Request, res: Response): Promise<void> => {
    try {
      const prompt = await promptRepository.getBehavioralPrompt();
      res.status(200).json({ prompt });
    } catch (error) {
      console.error('❌ [AdminController] Erro ao buscar prompt:', error);
      res.status(500).json({ error: 'Erro interno ao buscar o prompt.' });
    }
  };

  /**
   * POST /admin/prompt
   * Atualiza o prompt comportamental do Gemini no Firestore.
   * Body esperado: { "prompt": "novo texto de instrução" }
   */
  public updatePrompt = async (req: Request, res: Response): Promise<void> => {
    const { prompt } = req.body as { prompt?: string };

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      res.status(400).json({ error: 'O campo "prompt" é obrigatório e deve ser uma string não-vazia.' });
      return;
    }

    try {
      await promptRepository.updateBehavioralPrompt(prompt.trim());
      res.status(200).json({
        message: 'Prompt atualizado com sucesso. O cache será renovado imediatamente.',
        prompt: prompt.trim(),
      });
    } catch (error) {
      console.error('❌ [AdminController] Erro ao atualizar prompt:', error);
      res.status(500).json({ error: 'Erro interno ao atualizar o prompt.' });
    }
  };

  // ─── Triagem de Entrada ──────────────────────────────────────────────────

  /**
   * GET /admin/triagem/config
   * Retorna os requisitos/contexto/nome do grupo usados na triagem.
   */
  public getTriagemConfig = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.status(200).json(await triagemConfigRepository.get());
    } catch (error) {
      console.error('❌ [AdminController] Erro ao buscar config de triagem:', error);
      res.status(500).json({ error: 'Erro interno ao buscar a config de triagem.' });
    }
  };

  /**
   * POST /admin/triagem/config
   * Atualiza requisitos/contexto/nomeGrupo (qualquer subconjunto).
   * Body: { "requisitos"?: string, "contexto"?: string, "nomeGrupo"?: string }
   */
  public updateTriagemConfig = async (req: Request, res: Response): Promise<void> => {
    const { requisitos, contexto, nomeGrupo } = req.body as {
      requisitos?: string;
      contexto?: string;
      nomeGrupo?: string;
    };

    if (!requisitos && !contexto && !nomeGrupo) {
      res.status(400).json({ error: 'Informe ao menos um de: requisitos, contexto, nomeGrupo.' });
      return;
    }

    try {
      const atual = await triagemConfigRepository.update({ requisitos, contexto, nomeGrupo });
      res.status(200).json({ message: 'Config de triagem atualizada.', config: atual });
    } catch (error) {
      console.error('❌ [AdminController] Erro ao atualizar config de triagem:', error);
      res.status(500).json({ error: 'Erro interno ao atualizar a config de triagem.' });
    }
  };

  /**
   * GET /admin/triagem/candidato/:jid
   * Consulta o estado e a transcrição de um candidato.
   */
  public getTriagemCandidate = async (req: Request, res: Response): Promise<void> => {
    const { jid } = req.params;
    if (!jid) {
      res.status(400).json({ error: 'Parâmetro jid é obrigatório.' });
      return;
    }

    try {
      const candidate = await triagemCandidateRepository.get(jid);
      if (!candidate) {
        res.status(404).json({ message: 'Nenhum candidato encontrado para este JID.' });
        return;
      }
      res.status(200).json(candidate);
    } catch (error) {
      console.error('❌ [AdminController] Erro ao consultar candidato:', error);
      res.status(500).json({ error: 'Erro interno ao consultar o candidato.' });
    }
  };

  // ─── Resumo Mensal de Conversas ──────────────────────────────────────────

  /**
   * POST /admin/summary
   * Gera o resumo mensal das conversas de um grupo, sob demanda.
   *
   * Body: {
   *   groupJid: string;            // obrigatório
   *   ano?: number; mes?: number;  // default: mês anterior
   *   enviar?: boolean;            // default true (posta no grupo admin)
   *   destinoJid?: string;         // default ADMIN_GROUP_JID
   * }
   */
  public generateSummary = async (req: Request, res: Response): Promise<void> => {
    const { groupJid, ano, mes, enviar, destinoJid } = req.body as {
      groupJid?: string;
      ano?: number;
      mes?: number;
      enviar?: boolean;
      destinoJid?: string;
    };

    if (!groupJid || typeof groupJid !== 'string') {
      res.status(400).json({ error: 'O campo "groupJid" é obrigatório.' });
      return;
    }

    // Default: mês anterior ao atual.
    const agora = new Date();
    const anoAlvo = ano ?? (agora.getMonth() === 0 ? agora.getFullYear() - 1 : agora.getFullYear());
    const mesAlvo = mes ?? (agora.getMonth() === 0 ? 12 : agora.getMonth());

    if (mesAlvo < 1 || mesAlvo > 12) {
      res.status(400).json({ error: 'O campo "mes" deve estar entre 1 e 12.' });
      return;
    }

    try {
      if (enviar === false) {
        const relatorio = await conversationSummaryService.gerarRelatorioDoMes(groupJid, anoAlvo, mesAlvo);
        res.status(200).json({ ano: anoAlvo, mes: mesAlvo, enviado: false, relatorio });
        return;
      }

      const instance = process.env.EVOLUTION_INSTANCE;
      if (!instance) {
        res.status(500).json({ error: 'EVOLUTION_INSTANCE não configurado — não é possível enviar.' });
        return;
      }

      const relatorio = await conversationSummaryService.gerarEEnviar(
        instance,
        groupJid,
        anoAlvo,
        mesAlvo,
        destinoJid
      );
      res.status(200).json({ ano: anoAlvo, mes: mesAlvo, enviado: true, relatorio });
    } catch (error) {
      console.error('❌ [AdminController] Erro ao gerar resumo mensal:', error);
      res.status(500).json({ error: 'Erro interno ao gerar o resumo mensal.' });
    }
  };
}

export default new AdminController();
