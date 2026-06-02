import { Router, Request, Response, NextFunction } from 'express';
import AdminController from '../controllers/AdminController';
import WebinarAdminController from '../webinars/controllers/WebinarAdminController';

const router = Router();

/**
 * Middleware de autenticação para rotas administrativas.
 * Exige o header `x-admin-key` com o valor de ADMIN_API_KEY do .env.
 */
const adminAuthGuard = (req: Request, res: Response, next: NextFunction): void => {
  const expectedKey = process.env.ADMIN_API_KEY;
  
  // Aceita autenticação via x-admin-key OU Authorization: Bearer <token>
  const customHeader = req.headers['x-admin-key'] as string | undefined;
  const authHeader = req.headers['authorization'] as string | undefined;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  const providedKey = customHeader || bearerToken;

  if (!expectedKey || providedKey !== expectedKey) {
    res.status(403).json({ error: 'Forbidden: chave administrativa inválida.' });
    return;
  }

  next();
};

// Aplica o guard em todas as rotas admin
router.use(adminAuthGuard);

// GET  /admin/strikes/:remoteJid/:participantJid → consulta strikes
router.get('/strikes/:remoteJid/:participantJid', AdminController.getStrikes);

// DELETE /admin/strikes/:remoteJid/:participantJid → zera strikes (anistia)
router.delete('/strikes/:remoteJid/:participantJid', AdminController.resetStrikes);

// GET  /admin/prompt → retorna o prompt comportamental atual do Gemini
router.get('/prompt', AdminController.getPrompt);

// POST /admin/prompt → atualiza o prompt comportamental no Firestore
router.post('/prompt', AdminController.updatePrompt);

// ─── Módulo Bot Webinars ─────────────────────────────────────────────────────

// POST /admin/webinars → cria/atualiza webinar
router.post('/webinars', WebinarAdminController.upsertWebinar);

// GET  /admin/webinars → lista webinars
router.get('/webinars', WebinarAdminController.listWebinars);

// POST /admin/webinars/:id/status → atualiza status (finished dispara a COLETA)
router.post('/webinars/:id/status', WebinarAdminController.updateStatus);

// POST   /admin/groups → libera grupo na whitelist
router.post('/groups', WebinarAdminController.addGroup);

// GET    /admin/groups → lista grupos liberados
router.get('/groups', WebinarAdminController.listGroups);

// DELETE /admin/groups/:groupJid → remove grupo da whitelist
router.delete('/groups/:groupJid', WebinarAdminController.removeGroup);

export default router;
