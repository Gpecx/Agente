import * as admin from 'firebase-admin';
import { firebaseApp } from '../../config/firebase';
import { Pergunta } from '../interfaces/webinar.interface';

/** Repositório da coleção `perguntas` (dúvidas enviadas via /pergunta). */
class PerguntaRepository {
  private get db(): admin.firestore.Firestore {
    return firebaseApp.firestore();
  }

  private get col(): admin.firestore.CollectionReference {
    return this.db.collection('perguntas');
  }

  async registrar(usuarioId: string, webinarId: string, texto: string): Promise<void> {
    try {
      await this.col.add({
        usuarioId,
        webinarId,
        texto,
        respondida: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.error(`❌ [PerguntaRepository] Erro ao registrar pergunta de ${usuarioId}:`, error);
    }
  }

  async listarPorWebinar(webinarId: string): Promise<Pergunta[]> {
    try {
      const snap = await this.col.where('webinarId', '==', webinarId).get();
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Pergunta));
    } catch (error) {
      console.error('❌ [PerguntaRepository] Erro ao listar perguntas:', error);
      return [];
    }
  }
}

export default new PerguntaRepository();
