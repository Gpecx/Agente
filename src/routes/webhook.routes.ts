import { Router } from 'express';
import WebhookController from '../controllers/WebhookController';

const router = Router();

// Route specifically for Evolution API webhooks
// Map the POST /evolution to our controller method
router.post('/evolution', WebhookController.handleEvolutionWebhook);

export default router;
