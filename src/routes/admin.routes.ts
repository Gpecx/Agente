import { Router, Request, Response, NextFunction } from 'express';
import AdminController from '../controllers/AdminController';
import WebinarAdminController from '../webinars/controllers/WebinarAdminController';
import SparkAdminController from '../spark/controllers/SparkAdminController';

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

// ─── Triagem de Entrada ──────────────────────────────────────────────────────

// GET  /admin/triagem/config → requisitos/contexto atuais
router.get('/triagem/config', AdminController.getTriagemConfig);

// POST /admin/triagem/config → atualiza requisitos/contexto/nomeGrupo
router.post('/triagem/config', AdminController.updateTriagemConfig);

// GET  /admin/triagem/candidato/:jid → estado + transcrição de um candidato
router.get('/triagem/candidato/:jid', AdminController.getTriagemCandidate);
// POST /admin/summary → gera (e por padrão envia) o resumo mensal de um grupo
router.post('/summary', AdminController.generateSummary);

// ─── Módulo Bot Webinars ─────────────────────────────────────────────────────

// POST /admin/webinars → cria/atualiza webinar
router.post('/webinars', WebinarAdminController.upsertWebinar);

// GET  /admin/webinars → lista webinars
router.get('/webinars', WebinarAdminController.listWebinars);

// POST /admin/webinars/:id/status → atualiza status (finished dispara a COLETA)
router.post('/webinars/:id/status', WebinarAdminController.updateStatus);

// DELETE /admin/webinars/:id → remove o webinar
router.delete('/webinars/:id', WebinarAdminController.deleteWebinar);

// POST   /admin/groups → libera grupo na whitelist
router.post('/groups', WebinarAdminController.addGroup);

// GET    /admin/groups → lista grupos liberados
router.get('/groups', WebinarAdminController.listGroups);

// DELETE /admin/groups/:groupJid → remove grupo da whitelist
router.delete('/groups/:groupJid', WebinarAdminController.removeGroup);

// ─── Comunidade Spark ────────────────────────────────────────────────────────

// GET  /admin/spark/config → config operacional do Spark
router.get('/spark/config', SparkAdminController.getConfig);

// GET  /admin/spark/admins → lista JIDs autorizados a comandos Spark
router.get('/spark/admins', SparkAdminController.listAdmins);

// POST /admin/spark/admins → autoriza JID a comandos Spark
router.post('/spark/admins', SparkAdminController.addAdmin);

// DELETE /admin/spark/admins/:jid → remove autorização Spark
router.delete('/spark/admins/:jid', SparkAdminController.removeAdmin);

// GET  /admin/spark/members?limit=100 → lista membros Spark
router.get('/spark/members', SparkAdminController.listMembers);

// GET  /admin/spark/members/:jid → consulta um membro Spark
router.get('/spark/members/:jid', SparkAdminController.getMember);

// POST /admin/spark/members/:jid → ajusta estado operacional do membro
router.post('/spark/members/:jid', SparkAdminController.updateMember);

// POST /admin/spark/run/challenge → dispara o desafio semanal agora
router.post('/spark/run/challenge', SparkAdminController.runChallengeNow);

// POST /admin/spark/run/challenge-answer → dispara resposta + bonus agora
router.post('/spark/run/challenge-answer', SparkAdminController.runChallengeAnswerNow);

// POST /admin/spark/run/lifecycle → executa D+3 / D+10 agora
router.post('/spark/run/lifecycle', SparkAdminController.runLifecycleNow);

export default router;
