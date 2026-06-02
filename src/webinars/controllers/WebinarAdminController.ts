import { Request, Response } from 'express';
import webinarRepository from '../repositories/WebinarRepository';
import groupConfigRepository from '../../repositories/GroupConfigRepository';
import { Webinar, WebinarStatus } from '../interfaces/webinar.interface';

const STATUS_VALIDOS: WebinarStatus[] = ['scheduled', 'live', 'finished'];

/**
 * Endpoints administrativos do módulo de Webinars (protegidos pelo mesmo
 * adminAuthGuard / ADMIN_API_KEY das demais rotas admin).
 *
 * Resolve os itens operacionais que antes exigiam edição manual no Firestore:
 *  - cadastrar/listar/atualizar webinars (coleção `webinars`);
 *  - liberar/remover grupos da whitelist (coleção `allowed_groups`).
 */
class WebinarAdminController {
  /**
   * POST /api/admin/webinars
   * Cria ou atualiza um webinar.
   * Body: { id?, tema, dataHora (ISO 8601), palestrante, linkSala, status? }
   */
  public upsertWebinar = async (req: Request, res: Response): Promise<void> => {
    const { id, tema, dataHora, palestrante, linkSala, status } = req.body as {
      id?: string;
      tema?: string;
      dataHora?: string;
      palestrante?: string;
      linkSala?: string;
      status?: string;
    };

    if (!tema || !dataHora || !palestrante) {
      res.status(400).json({
        error: 'Campos obrigatórios: tema, dataHora (ISO 8601) e palestrante.',
      });
      return;
    }

    const data = new Date(dataHora);
    if (isNaN(data.getTime())) {
      res.status(400).json({ error: 'dataHora inválida. Use ISO 8601, ex.: 2026-07-01T20:00:00-03:00' });
      return;
    }

    if (status && !STATUS_VALIDOS.includes(status as WebinarStatus)) {
      res.status(400).json({ error: `status inválido. Use um de: ${STATUS_VALIDOS.join(', ')}` });
      return;
    }

    // Sem id explícito -> gera um baseado no timestamp atual (string, compatível com Firestore).
    const webinarId = id || String(Date.now());

    const webinar: Webinar = {
      id: webinarId,
      tema,
      dataHora: data,
      palestrante,
      linkSala: linkSala || '',
      status: (status as WebinarStatus) || 'scheduled',
    };

    try {
      await webinarRepository.upsert(webinar);
      res.status(200).json({
        message: 'Webinar salvo com sucesso.',
        webinar: { ...webinar, dataHora: webinar.dataHora.toISOString() },
      });
    } catch (error) {
      console.error('❌ [WebinarAdminController] Erro ao salvar webinar:', error);
      res.status(500).json({ error: 'Erro interno ao salvar o webinar.' });
    }
  };

  /** GET /api/admin/webinars — lista todos os webinars. */
  public listWebinars = async (_req: Request, res: Response): Promise<void> => {
    try {
      const webinars = await webinarRepository.listAtivos();
      res.status(200).json({
        count: webinars.length,
        webinars: webinars.map((w) => ({ ...w, dataHora: w.dataHora.toISOString() })),
      });
    } catch (error) {
      console.error('❌ [WebinarAdminController] Erro ao listar webinars:', error);
      res.status(500).json({ error: 'Erro interno ao listar webinars.' });
    }
  };

  /**
   * POST /api/admin/webinars/:id/status
   * Atualiza o status. Marcar 'finished' é o que dispara a fase de COLETA.
   * Body: { status: 'scheduled' | 'live' | 'finished' }
   */
  public updateStatus = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { status } = req.body as { status?: string };

    if (!status || !STATUS_VALIDOS.includes(status as WebinarStatus)) {
      res.status(400).json({ error: `status obrigatório. Use um de: ${STATUS_VALIDOS.join(', ')}` });
      return;
    }

    try {
      const existente = await webinarRepository.getById(id);
      if (!existente) {
        res.status(404).json({ error: `Webinar ${id} não encontrado.` });
        return;
      }
      await webinarRepository.updateStatus(id, status as WebinarStatus);
      res.status(200).json({ message: `Status do webinar ${id} atualizado para '${status}'.` });
    } catch (error) {
      console.error('❌ [WebinarAdminController] Erro ao atualizar status:', error);
      res.status(500).json({ error: 'Erro interno ao atualizar o status.' });
    }
  };

  // ─── Whitelist de grupos ────────────────────────────────────────────────────

  /**
   * POST /api/admin/groups
   * Libera um grupo na whitelist (sem isso o webhook ignora o grupo).
   * Body: { groupJid: "1203630...@g.us" }
   */
  public addGroup = async (req: Request, res: Response): Promise<void> => {
    const { groupJid } = req.body as { groupJid?: string };

    if (!groupJid || !groupJid.endsWith('@g.us')) {
      res.status(400).json({ error: 'groupJid obrigatório e deve terminar em @g.us.' });
      return;
    }

    try {
      await groupConfigRepository.addGroup(groupJid);
      res.status(200).json({ message: `Grupo ${groupJid} liberado na whitelist.` });
    } catch (error) {
      console.error('❌ [WebinarAdminController] Erro ao liberar grupo:', error);
      res.status(500).json({ error: 'Erro interno ao liberar o grupo.' });
    }
  };

  /** DELETE /api/admin/groups/:groupJid — remove o grupo da whitelist. */
  public removeGroup = async (req: Request, res: Response): Promise<void> => {
    const { groupJid } = req.params;
    try {
      await groupConfigRepository.removeGroup(groupJid);
      res.status(200).json({ message: `Grupo ${groupJid} removido da whitelist.` });
    } catch (error) {
      console.error('❌ [WebinarAdminController] Erro ao remover grupo:', error);
      res.status(500).json({ error: 'Erro interno ao remover o grupo.' });
    }
  };

  /** GET /api/admin/groups — lista os grupos liberados. */
  public listGroups = async (_req: Request, res: Response): Promise<void> => {
    try {
      const groups = await groupConfigRepository.listGroups();
      res.status(200).json({ count: groups.length, groups });
    } catch (error) {
      console.error('❌ [WebinarAdminController] Erro ao listar grupos:', error);
      res.status(500).json({ error: 'Erro interno ao listar grupos.' });
    }
  };
}

export default new WebinarAdminController();
