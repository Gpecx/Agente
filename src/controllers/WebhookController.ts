import { Request, Response } from 'express';
import { EvolutionWebhookPayload } from '../interfaces/evolution.interface';
import moderationService from '../services/ModerationService';
import participantService from '../services/ParticipantService';
import rateLimiter from '../utils/RateLimiter';
import groupConfigRepository from '../repositories/GroupConfigRepository';
import webinarOrchestrator from '../webinars/services/WebinarOrchestrator';
import triagemService from '../triagem/services/TriagemService';

class WebhookController {
  /**
   * Handles incoming webhooks from Evolution API
   */
  public handleEvolutionWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      // 0. Debug opcional: loga TODO webhook recebido (ative com DEBUG_WEBHOOK=true).
      //    Útil pra ver chegada de mensagens e o motivo de quedas de conexão.
      if (process.env.DEBUG_WEBHOOK === 'true') {
        const ev = req.body?.event;
        const st = req.body?.data?.state || req.body?.data?.connection;
        const code = req.body?.data?.lastDisconnect?.error?.output?.statusCode
          ?? req.body?.data?.statusReason;
        const rj = req.body?.data?.key?.remoteJid;
        const fm = req.body?.data?.key?.fromMe;
        console.log(
          `📥 [webhook] event=${ev}` +
          (st ? ` state=${st}` : '') +
          (code !== undefined ? ` code=${code}` : '') +
          (rj ? ` from=${rj} fromMe=${fm}` : '')
        );
      }

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

      // 2.5 Triagem de entrada por DM (intake de novos membros).
      //     Roda ANTES da whitelist de grupos: mensagens individuais (não-grupo)
      //     nunca estão na whitelist e seriam descartadas. Gated por TRIAGEM_ENABLED.
      //     O rate-limiter (passo 2) já protege contra flood/custo.
      const dmJid = payload.data?.key?.remoteJid;
      if (
        process.env.TRIAGEM_ENABLED === 'true' &&
        payload.event === 'messages.upsert' &&
        !payload.data?.key?.fromMe &&
        dmJid?.endsWith('@s.whatsapp.net')
      ) {
        const textoDm = moderationService.extractText(payload);
        if (textoDm) {
          // Fire-and-forget: libera o Express para responder 200 imediatamente.
          triagemService
            .handleDM(payload.instance, dmJid, textoDm, payload.data?.pushName || '')
            .catch((error) => console.error('❌ [WebhookController] Falha na triagem por DM:', error));
        }
        res.status(200).json({ status: 'triagem' });
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
