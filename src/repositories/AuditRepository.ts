import * as admin from 'firebase-admin';
import { firebaseApp } from '../config/firebase';

class AuditRepository {
  private get db(): admin.firestore.Firestore {
    return firebaseApp.firestore();
  }

  /**
   * Registra o log de uma infração de moderação para auditoria futura.
   * Salva as evidências completas (texto original) e o motivo da ação no Firestore.
   */
  public async logInfraction(remoteJid: string, participantJid: string, text: string, reason: string): Promise<void> {
    try {
      await this.db.collection('moderation_logs').add({
        remoteJid,
        participantJid,
        text, // Evidência mantida in-natura para contestação
        reason,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`📝 [Audit] Registro de infração salvo em moderation_logs para ${participantJid}`);
    } catch (error) {
      console.error('❌ [Firestore] Erro ao gravar o log de infração na auditoria:', error);
      // Falha silenciosa para não travar a esteira principal de moderação
    }
  }
}

export default new AuditRepository();
