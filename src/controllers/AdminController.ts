import { Request, Response } from 'express';
import strikeRepository from '../repositories/StrikeRepository';
import promptRepository from '../repositories/PromptRepository';

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
}

export default new AdminController();
