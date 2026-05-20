import * as admin from 'firebase-admin';
import { firebaseApp } from '../config/firebase';

export interface UserStrikeRecord {
  strikeCount: number;
  lastInfraction: admin.firestore.Timestamp | admin.firestore.FieldValue | Date;
}

/**
 * Repositório responsável por gerenciar a camada de persistência dos Strikes 
 * (sistema de infrações) no Firestore de forma eficiente e atômica.
 */
class StrikeRepository {
  /**
   * Garante a captura da instância ativa do banco no Singleton.
   */
  private get db(): admin.firestore.Firestore {
    return firebaseApp.firestore();
  }

  /**
   * Utilitário para padronizar o caminho e obter a referência do documento no Firestore.
   * Utiliza a hierarquia: groups -> {remoteJid} -> users -> {participantJid}
   */
  private getUserRef(remoteJid: string, participantJid: string): admin.firestore.DocumentReference {
    return this.db.collection('groups').doc(remoteJid).collection('users').doc(participantJid);
  }

  /**
   * Registra uma infração atômica e atualiza a data do evento de forma segura contra concorrências.
   * 
   * @param remoteJid Identificador único do grupo.
   * @param participantJid Identificador único do participante infrator.
   * @returns O total atual de strikes do participante (fallback para 0 em caso de erro).
   */
  public async registerStrike(remoteJid: string, participantJid: string): Promise<number> {
    try {
      const userRef = this.getUserRef(remoteJid, participantJid);

      // set com merge garante a criação do doc caso não exista e realiza o incremento atômico
      await userRef.set(
        {
          strikeCount: admin.firestore.FieldValue.increment(1),
          lastInfraction: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      // Recuperamos o dado de volta na mesma transação lógica para obter o novo counter
      const snapshot = await userRef.get();
      const data = snapshot.data() as UserStrikeRecord;

      return data?.strikeCount || 1;
    } catch (error) {
      console.error(`❌ [Firestore] Erro Crítico ao registrar strike para ${participantJid} no grupo ${remoteJid}:`, error);
      // Retorna 0 para evitar quebra completa do fluxo de moderação. 
      // Se não for possível persistir, deixamos falhar silenciosamente para proteger a esteira de webhooks.
      return 0;
    }
  }

  /**
   * Consulta o registro atual de infrações de um usuário.
   */
  public async getRecord(remoteJid: string, participantJid: string): Promise<UserStrikeRecord | null> {
    try {
      const userRef = this.getUserRef(remoteJid, participantJid);
      const snapshot = await userRef.get();

      if (!snapshot.exists) {
        return null;
      }

      return snapshot.data() as UserStrikeRecord;
    } catch (error) {
      console.error(`❌ [Firestore] Erro ao consultar record de ${participantJid} em ${remoteJid}:`, error);
      return null;
    }
  }

  /**
   * Zera as advertências de um usuário. Ideal para processos pós-kick, pós-ban ou rotinas de anistia.
   * 
   * @param remoteJid Identificador único do grupo.
   * @param participantJid Identificador único do participante perdoado.
   */
  public async resetStrikes(remoteJid: string, participantJid: string): Promise<void> {
    try {
      const userRef = this.getUserRef(remoteJid, participantJid);

      await userRef.set(
        {
          strikeCount: 0,
        },
        { merge: true }
      );

      console.log(`🔄 [Firestore] Strikes zerados com sucesso para ${participantJid} no grupo ${remoteJid}`);
    } catch (error) {
      console.error(`❌ [Firestore] Falha ao tentar resetar os strikes de ${participantJid} no grupo ${remoteJid}:`, error);
      // Fails silently as requested by error boundaries
    }
  }
}

export default new StrikeRepository();
