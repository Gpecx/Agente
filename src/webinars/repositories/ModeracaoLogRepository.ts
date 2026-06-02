import * as admin from 'firebase-admin';
import { firebaseApp } from '../../config/firebase';
import { AcaoModeracao, LogModeracao } from '../interfaces/webinar.interface';

/**
 * Repositório da coleção `logs_moderacao` (auditoria de ações do bot de webinars).
 * Separado do `moderation_logs` da moderação base para não misturar contextos.
 */
class ModeracaoLogRepository {
  private get db(): admin.firestore.Firestore {
    return firebaseApp.firestore();
  }

  private get col(): admin.firestore.CollectionReference {
    return this.db.collection('logs_moderacao');
  }

  async log(usuarioId: string, acao: AcaoModeracao, motivo: string): Promise<void> {
    try {
      await this.col.add({
        usuarioId,
        acao,
        motivo,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.error(`❌ [ModeracaoLogRepository] Erro ao logar ação ${acao} de ${usuarioId}:`, error);
    }
  }

  async listarRecentes(limit = 100): Promise<LogModeracao[]> {
    try {
      const snap = await this.col.orderBy('createdAt', 'desc').limit(limit).get();
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as LogModeracao));
    } catch (error) {
      console.error('❌ [ModeracaoLogRepository] Erro ao listar logs:', error);
      return [];
    }
  }
}

export default new ModeracaoLogRepository();
