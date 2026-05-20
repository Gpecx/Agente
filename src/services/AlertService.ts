import evolutionApiService from './EvolutionApiService';

class AlertService {
  /**
   * Notifica a equipe de administração de forma dupla:
   * 1. Console Estruturado para o GCP Cloud Logging (usando JSON para indexação nativa)
   * 2. Mensagem direta em um grupo de administradores via WhatsApp
   */
  public async notifyAdminOfBan(instance: string, remoteJid: string, bannedJid: string, reason: string): Promise<void> {
    const adminGroup = process.env.ADMIN_GROUP_JID;
    
    // 1. Log Estruturado (Métricas Nativas do GCP Cloud Logging)
    try {
      const gcpLogPayload = {
        severity: 'WARNING',
        event: 'USER_BANNED',
        group: remoteJid,
        user: bannedJid,
        reason: reason,
        timestamp: new Date().toISOString()
      };
      
      // O GCP Cloud Logging intercepta e formata automaticamente stderr gerado como JSON.
      console.warn(JSON.stringify(gcpLogPayload));
    } catch (error) {
      console.error('❌ [AlertService] Erro ao gerar métrica estruturada para o GCP:', error);
    }

    // 2. Alerta Ativo no WhatsApp (Evolution API)
    if (adminGroup) {
      try {
        const text = `🚨 *ALERTA DE MODERAÇÃO* 🚨\n\n` +
                     `👥 *Grupo Origem:* ${remoteJid}\n` +
                     `👤 *Infrator:* @${bannedJid.replace(/@.+/, '')}\n` +
                     `🛑 *Motivo do Ban:* ${reason}\n\n` +
                     `🔨 O limite de infrações foi atingido e o membro removido do grupo automaticamente.`;
                     
        await evolutionApiService.sendTextWithMention(instance, adminGroup, text, bannedJid);
        console.log('✅ [AlertService] Alerta enviado ao grupo de admins.');
      } catch (error) {
        console.error('❌ [AlertService] Falha ao enviar notificação de banimento para o grupo de administradores:', error);
      }
    } else {
      console.log('ℹ️ [AlertService] ADMIN_GROUP_JID não configurado. Alerta via WhatsApp ignorado.');
    }
  }
}

export default new AlertService();
