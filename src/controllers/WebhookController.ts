import { Request, Response } from 'express';
import { EvolutionWebhookPayload } from '../interfaces/evolution.interface';
import moderationService from '../services/ModerationService';
import participantService from '../services/ParticipantService';
import rateLimiter from '../utils/RateLimiter';
import groupConfigRepository from '../repositories/GroupConfigRepository';
import webinarOrchestrator from '../webinars/services/WebinarOrchestrator';

class WebhookController {
  /**
   * Handles incoming webhooks from Evolution API
   */
  public handleEvolutionWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      // 1. Authorization Validation
      const authHeader = this.getHeaderValue(req, 'x-webhook-secret') || this.getHeaderValue(req, 'authorization');
      const expectedSecret = process.env.WEBHOOK_SECRET;

      if (expectedSecret && authHeader !== expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
        console.warn('🔒 Unauthorized webhook access attempt');
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const payload = req.body as EvolutionWebhookPayload;

      // 2. Anti-Flood / Rate Limiting (Proteção contra sobrecarga e estouro de custos)
      // Identifica o autor gerador do evento para classificar o flood
      const actorJid = payload.data?.key?.participant || payload.data?.key?.remoteJid || payload.data?.id;
      
      if (actorJid && rateLimiter.isRateLimited(actorJid)) {
        console.warn(`⏳ [RateLimiter] Flood detectado de ${actorJid}. Requisição descartada silenciosamente.`);
        res.status(200).json({ status: 'ignored', reason: 'Rate limit exceeded (Flood)' });
        return;
      }

      // 3. Whitelist de Grupos (Barreira Arquitetural contra custos indesejados no Vertex AI)
      const remoteJid = payload.data?.key?.remoteJid || payload.data?.id || payload.data?.groupJid;
      
      if (remoteJid && !(await groupConfigRepository.isGroupAllowed(remoteJid))) {
        // Grupo não autorizado: Early return silencioso O(1). Nem o webhook da Evolution vai reclamar.
        res.status(200).json({ status: 'ignored', reason: 'Group not in whitelist' });
        return;
      }

      // 4. Loop Prevention (Ignore messages sent by the bot itself)
      if (payload.data?.key?.fromMe) {
        // Return 200 to acknowledge receipt without further processing
        res.status(200).json({ status: 'ignored', reason: 'fromMe flag is true' });
        return;
      }

      // 5. Event Routing
      switch (payload.event) {
        case 'messages.upsert':
          await this.handleMessagesUpsert(payload);
          break;
        case 'group-participants.update':
          await this.handleGroupParticipantsUpdate(payload);
          break;
        default:
          console.log(`ℹ️ Unhandled webhook event: ${payload.event}`);
          break;
      }

      // 4. Successful Acknowledgment
      res.status(200).json({ success: true });
    } catch (error) {
      console.error('❌ Error processing Evolution webhook:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  };

  /**
   * Helper to safely extract single header values
   */
  private getHeaderValue(req: Request, name: string): string | undefined {
    const value = req.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }

  /**
   * Handles the 'messages.upsert' event
   */
  private async handleMessagesUpsert(payload: EvolutionWebhookPayload): Promise<void> {
    const remoteJid = payload.data?.key?.remoteJid;
    const participant = payload.data?.key?.participant || remoteJid;

    console.log(`📨 [messages.upsert] Message received in chat: ${remoteJid} from participant: ${participant}`);

    // 1) Moderação-base existente (links/palavrão -> strikes/kick).
    const baseHandled = await moderationService.processMessage(payload);

    // 2) Módulo de Webinars (reações/opt-in, comandos, mute simulado).
    //    Reusa o texto já extraído pela moderação-base.
    const texto = moderationService.extractText(payload);
    await webinarOrchestrator.onMessage(payload, texto, baseHandled);
  }

  /**
   * Handles the 'group-participants.update' event.
   * Useful for auditing joins/leaves or triggering welcome messages.
   */
  private async handleGroupParticipantsUpdate(payload: EvolutionWebhookPayload): Promise<void> {
    console.log(`👥 [group-participants.update] Participants changed event triggered for: ${payload.instance}`);
    
    // "Fire and forget": delegamos para o serviço rodar em background e liberamos
    // imediatamente o Express para responder 200 à Evolution API.
    participantService.handleParticipantUpdate(payload).catch(error => {
      console.error('❌ [WebhookController] Falha silenciosa no ParticipantService:', error);
    });

    // Módulo de Webinars: boas-vindas + CTA de inscrição (respeitando anti-ban).
    webinarOrchestrator.onParticipantUpdate(payload).catch(error => {
      console.error('❌ [WebhookController] Falha silenciosa no WebinarOrchestrator:', error);
    });
  }
}

export default new WebhookController();
