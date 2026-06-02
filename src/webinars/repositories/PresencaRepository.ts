import * as admin from 'firebase-admin';
import { firebaseApp } from '../../config/firebase';
import { Presenca } from '../interfaces/webinar.interface';

/**
 * Repositório da coleção `presencas`.
 * Doc id = `${webinarId}:${usuarioId}` -> idempotência natural do /presente.
 */
class PresencaRepository {
  private get db(): admin.firestore.Firestore {
    return firebaseApp.firestore();
  }

  private get col(): admin.firestore.CollectionReference {
    return this.db.collection('presencas');
  }

  private docId(webinarId: string, usuarioId: string): string {
    return `${webinarId}:${usuarioId}`;
  }

  /** Registra o check-in (/presente). Idempotente: não duplica para o mesmo webinar. */
  async checkIn(usuarioId: string, webinarId: string): Promise<void> {
    try {
      await this.col.doc(this.docId(webinarId, usuarioId)).set(
        {
          usuarioId,
          webinarId,
          checkIn: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      console.error(`❌ [PresencaRepository] Erro no check-in de ${usuarioId}:`, error);
    }
  }

  /** Define o percentual de presença (0.0 a 1.0) — calculado ao fim da live. */
  async setPercentual(usuarioId: string, webinarId: string, percentual: number): Promise<void> {
    try {
      await this.col
        .doc(this.docId(webinarId, usuarioId))
        .set({ usuarioId, webinarId, percentual }, { merge: true });
    } catch (error) {
      console.error(`❌ [PresencaRepository] Erro ao gravar percentual de ${usuarioId}:`, error);
    }
  }

  async get(usuarioId: string, webinarId: string): Promise<Presenca | null> {
    try {
      const doc = await this.col.doc(this.docId(webinarId, usuarioId)).get();
      if (!doc.exists) return null;
      return { id: doc.id, ...(doc.data() as any) } as Presenca;
    } catch (error) {
      console.error(`❌ [PresencaRepository] Erro ao buscar presença de ${usuarioId}:`, error);
      return null;
    }
  }

  async listarPorWebinar(webinarId: string): Promise<Presenca[]> {
    try {
      const snap = await this.col.where('webinarId', '==', webinarId).get();
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Presenca));
    } catch (error) {
      console.error('❌ [PresencaRepository] Erro ao listar presenças:', error);
      return [];
    }
  }
}

export default new PresencaRepository();
