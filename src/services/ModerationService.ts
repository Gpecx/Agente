import { EvolutionWebhookPayload } from '../interfaces/evolution.interface';
import evolutionApiService from './EvolutionApiService';
import strikeRepository from '../repositories/StrikeRepository';
import auditRepository from '../repositories/AuditRepository';
import alertService from './AlertService';
import geminiModerationService from './GeminiModerationService';
import { RegexAnalyzer } from '../utils/RegexAnalyzer';

// --- Constantes de Moderação ---
const MAX_STRIKES = 3;

/**
 * Serviço que orquestra as regras de negócio de moderação de grupos.
 * Integra o StrikeRepository e o EvolutionApiService para aplicar punições de forma escalável.
 */
class ModerationService {
  /**
   * Método principal que recebe o payload do webhook e aplica as regras de moderação.
   */
  public async processMessage(payload: EvolutionWebhookPayload): Promise<void> {
    try {
      // 1. Extração segura dos campos necessários
      const messageText = this.extractMessageText(payload);
      const remoteJid = payload.data?.key?.remoteJid;
      const participant = payload.data?.key?.participant || payload.data?.key?.remoteJid;
      const messageId = payload.data?.key?.id;

      // Guard clause: ignora se faltar dados essenciais para a moderação
      if (!messageText || !remoteJid || !participant || !messageId) {
        console.log('⚠️ [ModerationService] Mensagem ignorada por dados insuficientes.');
        return;
      }

      let isInfringing = false;
      let infractionType = '';

      // 2. Primeira Camada (Custo Zero / O(1)): Verifica via RegexAnalyzer
      const hasUrl = RegexAnalyzer.containsLink(messageText);
      const hasForbiddenWord = RegexAnalyzer.containsProfanity(messageText);

      if (hasUrl || hasForbiddenWord) {
        // Punido por Regras Claras (Heurística Estática)
        isInfringing = true;
        infractionType = hasUrl ? 'Link não autorizado (Regex)' : 'Palavra proibida explícita (Filtro Base)';
      } else {
        // 2.5. Segunda Camada (IA Semântica): A Regex falhou em pegar algo. 
        // Passamos pelo funil de IA (Gemini Vertex AI) para analise complexa de contexto.
        const geminiResult = await geminiModerationService.analyzeText(messageText);
        
        if (geminiResult.isInfraction) {
          isInfringing = true;
          infractionType = `IA Semântica: ${geminiResult.reason || 'Comportamento malicioso deduzido'}`;
        }
      }

      if (!isInfringing) {
        return; // Mensagem limpa (passou nas 2 camadas), encerra o fluxo com sucesso
      }

      console.log(`🚨 [ModerationService] Infração detectada (${infractionType}) de ${participant} no grupo ${remoteJid}`);

      // 3. Registra o strike de forma atômica no Firestore
      const strikeCount = await strikeRepository.registerStrike(remoteJid, participant);

      // 3.5. Grava o log de auditoria da infração no banco (tratamento de erro contido no repositório)
      await auditRepository.logInfraction(remoteJid, participant, messageText, infractionType);

      // 4. Deleta a mensagem infratora (independente do strikeCount)
      await evolutionApiService.deleteMessage(payload.instance, remoteJid, messageId, payload.data.key!.fromMe);

      // 5. Aplica a punição baseada no total de strikes
      if (strikeCount < MAX_STRIKES) {
        // Avisa o usuário com uma menção direta
        const warningText =
          `⚠️ @${participant.replace(/@.+/, '')} — Sua mensagem foi removida por conter ${infractionType}.\n` +
          `📋 Advertências: *${strikeCount}/${MAX_STRIKES}*.\n` +
          `⚡ Ao atingir ${MAX_STRIKES} advertências, você será removido do grupo.`;

        await evolutionApiService.sendTextWithMention(payload.instance, remoteJid, warningText, participant);
      } else {
        // Strike limite atingido: kick do participante
        console.log(`🔨 [ModerationService] Strike máximo atingido! Removendo ${participant} do grupo ${remoteJid}...`);

        await evolutionApiService.removeParticipant(payload.instance, remoteJid, [participant]);

        // Dispara os alertas nativos para a administração (GCP Logging e Grupo WhatsApp)
        await alertService.notifyAdminOfBan(payload.instance, remoteJid, participant, infractionType);

        // Notifica o grupo sobre o kick
        const kickText =
          `🚫 O participante @${participant.replace(/@.+/, '')} foi removido do grupo ` +
          `por atingir o limite de *${MAX_STRIKES} advertências*.`;

        await evolutionApiService.sendTextWithMention(payload.instance, remoteJid, kickText, participant);

        // Zera a ficha do usuário após o kick
        await strikeRepository.resetStrikes(remoteJid, participant);
      }
    } catch (error) {
      console.error('❌ [ModerationService] Erro não esperado durante processamento de mensagem:', error);
      // Falha silenciosa para não quebrar a esteira de webhooks
    }
  }

  /**
   * Extrai o texto de uma mensagem lidando com as variações estruturais do WhatsApp.
   * O WhatsApp pode enviar a mensagem em diferentes nós dependendo do tipo.
   */
  private extractMessageText(payload: EvolutionWebhookPayload): string | null {
    const message = payload.data?.message;

    if (!message) return null;

    // Texto simples de conversas individuais
    if (typeof message.conversation === 'string') {
      return message.conversation;
    }

    // Texto em respostas ou mensagens com formatação
    if (typeof message.extendedTextMessage?.text === 'string') {
      return message.extendedTextMessage.text;
    }

    // Texto em mensagens de imagem/vídeo com legenda
    if (typeof message.imageMessage?.caption === 'string') {
      return message.imageMessage.caption;
    }

    if (typeof message.videoMessage?.caption === 'string') {
      return message.videoMessage.caption;
    }

    return null;
  }
}

export default new ModerationService();
