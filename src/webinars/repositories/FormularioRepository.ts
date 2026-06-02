import * as admin from 'firebase-admin';
import { firebaseApp } from '../../config/firebase';
import { Formulario } from '../interfaces/webinar.interface';

/**
 * Repositório da coleção `formularios` (NPS + conclusão).
 * Doc id = `${webinarId}:${usuarioId}` -> 1 form por usuário/webinar.
 */
class FormularioRepository {
  private get db(): admin.firestore.Firestore {
    return firebaseApp.firestore();
  }

  private get col(): admin.firestore.CollectionReference {
    return this.db.collection('formularios');
  }

  private docId(webinarId: string, usuarioId: string): string {
    return `${webinarId}:${usuarioId}`;
  }

  async salvar(
    usuarioId: string,
    webinarId: string,
    nps: number,
    completo: boolean
  ): Promise<void> {
    try {
      await this.col.doc(this.docId(webinarId, usuarioId)).set(
        {
          usuarioId,
          webinarId,
          nps,
          completo,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      console.error(`❌ [FormularioRepository] Erro ao salvar form de ${usuarioId}:`, error);
    }
  }

  async get(usuarioId: string, webinarId: string): Promise<Formulario | null> {
    try {
      const doc = await this.col.doc(this.docId(webinarId, usuarioId)).get();
      if (!doc.exists) return null;
      return { id: doc.id, ...(doc.data() as any) } as Formulario;
    } catch (error) {
      console.error(`❌ [FormularioRepository] Erro ao buscar form de ${usuarioId}:`, error);
      return null;
    }
  }

  async isCompleto(usuarioId: string, webinarId: string): Promise<boolean> {
    const f = await this.get(usuarioId, webinarId);
    return !!f?.completo;
  }

  async listarPorWebinar(webinarId: string): Promise<Formulario[]> {
    try {
      const snap = await this.col.where('webinarId', '==', webinarId).get();
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Formulario));
    } catch (error) {
      console.error('❌ [FormularioRepository] Erro ao listar formulários:', error);
      return [];
    }
  }

  /** Usuários que NÃO completaram o form (para lembrete D+1). */
  async listarIncompletosPorWebinar(webinarId: string): Promise<string[]> {
    const todos = await this.listarPorWebinar(webinarId);
    return todos.filter((f) => !f.completo).map((f) => f.usuarioId);
  }
}

export default new FormularioRepository();
