import * as admin from 'firebase-admin';
import { firebaseApp } from '../../config/firebase';
import { WebinarUsuario } from '../interfaces/webinar.interface';

/**
 * Repositório da coleção `webinar_usuarios`.
 * PK = JID do WhatsApp (ex.: 5511999999999@s.whatsapp.net).
 *
 * Centraliza o opt-in para DM (campo `notificacao`) e o estado de "mute" simulado
 * (`silenciadoAte`, ver WebinarModerationService).
 */
class WebinarUserRepository {
  private get db(): admin.firestore.Firestore {
    return firebaseApp.firestore();
  }

  private get col(): admin.firestore.CollectionReference {
    return this.db.collection('webinar_usuarios');
  }

  async get(jid: string): Promise<WebinarUsuario | null> {
    try {
      const doc = await this.col.doc(jid).get();
      if (!doc.exists) return null;
      return { id: doc.id, ...(doc.data() as any) } as WebinarUsuario;
    } catch (error) {
      console.error(`❌ [WebinarUserRepository] Erro ao buscar ${jid}:`, error);
      return null;
    }
  }

  /** Garante o documento do usuário (idempotente). Usado na entrada do grupo. */
  async ensure(jid: string, username?: string): Promise<void> {
    try {
      await this.col.doc(jid).set(
        {
          username: username || null,
          joinedAt: admin.firestore.FieldValue.serverTimestamp(),
          // não sobrescreve notificacao se já existir
        },
        { merge: true }
      );
    } catch (error) {
      console.error(`❌ [WebinarUserRepository] Erro ao garantir usuário ${jid}:`, error);
    }
  }

  /** Marca opt-in (reagiu com o emoji de lembrete ou mandou DM ao bot). */
  async setOptIn(jid: string, optIn: boolean, username?: string): Promise<void> {
    try {
      const payload: Record<string, any> = { notificacao: optIn };
      if (username) payload.username = username;
      await this.col.doc(jid).set(payload, { merge: true });
    } catch (error) {
      console.error(`❌ [WebinarUserRepository] Erro ao gravar opt-in de ${jid}:`, error);
    }
  }

  /** Verifica se o usuário deu opt-in (gate obrigatório para DM em lote). */
  async hasOptIn(jid: string): Promise<boolean> {
    const u = await this.get(jid);
    return !!u?.notificacao;
  }

  /** Define a janela de "mute" simulado (epoch ms). */
  async setSilenciadoAte(jid: string, epochMs: number | null): Promise<void> {
    try {
      await this.col.doc(jid).set({ silenciadoAte: epochMs }, { merge: true });
    } catch (error) {
      console.error(`❌ [WebinarUserRepository] Erro ao silenciar ${jid}:`, error);
    }
  }

  /** Retorna os JIDs que deram opt-in (para envios de lembrete em lote). */
  async listOptIn(): Promise<string[]> {
    try {
      const snap = await this.col.where('notificacao', '==', true).get();
      return snap.docs.map((d) => d.id);
    } catch (error) {
      console.error('❌ [WebinarUserRepository] Erro ao listar opt-ins:', error);
      return [];
    }
  }

  /** Retorna os JIDs que entraram no grupo há menos de N dias. */
  async listMembrosRecentes(dias: number, agora: Date = new Date()): Promise<string[]> {
    try {
      const limite = admin.firestore.Timestamp.fromDate(
        new Date(agora.getTime() - dias * 24 * 60 * 60 * 1000)
      );
      const snap = await this.col.where('joinedAt', '>=', limite).get();
      return snap.docs.map((d) => d.id);
    } catch (error) {
      console.error('❌ [WebinarUserRepository] Erro ao listar membros recentes:', error);
      return [];
    }
  }
}

export default new WebinarUserRepository();
