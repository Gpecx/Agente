import { EvolutionWebhookPayload } from '../interfaces/evolution.interface';
import evolutionApiService from './EvolutionApiService';

/**
 * Serviço responsável por processar as atualizações e ações de participantes 
 * (entrada, saída, promoção, rebaixamento) em grupos monitorados.
 */
class ParticipantService {
  /**
   * Ponto de entrada do processamento assíncrono para o evento `group-participants.update`.
   */
  public async handleParticipantUpdate(payload: EvolutionWebhookPayload): Promise<void> {
    try {
      const action = payload.data?.action; // 'add', 'remove', 'promote', 'demote'
      
      // O ID do grupo pode vir no payload nativo da Evolution de diferentes formas dependendo da versão
      const remoteJid = payload.data?.id || payload.data?.key?.remoteJid || payload.data?.groupJid;
      
      // Participantes alvo da ação
      const participants: string[] = payload.data?.participants || [];

      if (!action || !remoteJid || participants.length === 0) {
        return;
      }

      // Interceptação e Regras de Negócio na Entrada do Grupo
      if (action === 'add') {
        for (const participant of participants) {
          // Ex: "5511999999999@s.whatsapp.net" -> "5511999999999"
          const numberOnly = participant.split('@')[0];

          // --- Regra: Sistema Anti-Fake (Filtro por DDI Estrangeiro) ---
          if (!numberOnly.startsWith('55')) {
            console.log(`🛡️ [Anti-Fake] Usuário com DDI não-br detectado (${participant}). Executando kick...`);
            
            // Remove (kick) o membro automaticamente
            await evolutionApiService.removeParticipant(payload.instance, remoteJid, [participant]);
            
            // Emite comunicado no grupo para transparência
            const alertMsg = `🚫 O participante @${numberOnly} foi removido automaticamente.\n` + 
                             `🔒 *Motivo:* Sistema Anti-Fake (Números estrangeiros bloqueados).`;
            
            await evolutionApiService.sendTextWithMention(payload.instance, remoteJid, alertMsg, participant);
            continue; // Pula as boas-vindas já que ele foi banido
          }

          // --- Regra: Boas-Vindas Padronizada ---
          console.log(`👋 [ParticipantService] Enviando boas-vindas para: ${participant}`);
          
          const welcomeMsg = `👋 Olá, @${numberOnly}! Seja muito bem-vindo(a).\n\n` +
                             `⚠️ *Importante:* Leia atentamente a descrição do grupo.\n` +
                             `🤖 Nossa comunidade é blindada por um bot moderador de IA. Não envie links ou palavras ofensivas, sujeito a banimento automático.\n\n` +
                             `Aproveite!`;

          await evolutionApiService.sendTextWithMention(payload.instance, remoteJid, welcomeMsg, participant);
        }
      }
    } catch (error) {
      console.error('❌ [ParticipantService] Erro inesperado ao processar atualização de participante:', error);
    }
  }
}

export default new ParticipantService();
