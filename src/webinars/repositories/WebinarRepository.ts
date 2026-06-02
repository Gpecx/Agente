import * as admin from 'firebase-admin';
import { firebaseApp } from '../../config/firebase';
import { Webinar, WebinarStatus } from '../interfaces/webinar.interface';

/**
 * Repositório da coleção `webinars`.
 * Segue o padrão dos repositórios existentes (Firestore Admin SDK, fail-silent).
 */
class WebinarRepository {
  private get db(): admin.firestore.Firestore {
    return firebaseApp.firestore();
  }

  private get col(): admin.firestore.CollectionReference {
    return this.db.collection('webinars');
  }

  /** Converte um documento bruto do Firestore para o tipo de domínio Webinar. */
  private toWebinar(doc: admin.firestore.DocumentSnapshot): Webinar | null {
    if (!doc.exists) return null;
    const d = doc.data() as any;
    const dataHora: Date =
      d.dataHora instanceof admin.firestore.Timestamp
        ? d.dataHora.toDate()
        : new Date(d.dataHora);

    return {
      id: doc.id,
      tema: d.tema || '',
      dataHora,
      palestrante: d.palestrante || '',
      linkSala: d.linkSala || '',
      status: (d.status as WebinarStatus) || 'scheduled',
    };
  }

  async getById(id: string): Promise<Webinar | null> {
    try {
      const doc = await this.col.doc(id).get();
      return this.toWebinar(doc);
    } catch (error) {
      console.error(`❌ [WebinarRepository] Erro ao buscar webinar ${id}:`, error);
      return null;
    }
  }

  /**
   * Retorna o próximo webinar agendado (status !== finished, dataHora >= agora),
   * ordenado pelo mais próximo. Usado por /proximo e pelos crons.
   */
  async getProximo(agora: Date = new Date()): Promise<Webinar | null> {
    try {
      const snap = await this.col
        .where('status', 'in', ['scheduled', 'live'])
        .orderBy('dataHora', 'asc')
        .get();

      for (const doc of snap.docs) {
        const w = this.toWebinar(doc);
        if (w && w.dataHora.getTime() >= agora.getTime() - 4 * 60 * 60 * 1000) {
          // tolera até 4h passadas (live em andamento) para não "perder" o evento do dia
          return w;
        }
      }
      // fallback: o primeiro da lista (mesmo que já tenha passado)
      return snap.docs.length ? this.toWebinar(snap.docs[0]) : null;
    } catch (error) {
      console.error('❌ [WebinarRepository] Erro ao buscar próximo webinar:', error);
      return null;
    }
  }

  /**
   * Retorna webinars "ativos" para o scheduler: qualquer um cuja janela de
   * estados ainda não terminou (de D-7 até D+2). Best-effort.
   */
  async listAtivos(): Promise<Webinar[]> {
    try {
      const snap = await this.col.orderBy('dataHora', 'asc').get();
      const out: Webinar[] = [];
      for (const doc of snap.docs) {
        const w = this.toWebinar(doc);
        if (w) out.push(w);
      }
      return out;
    } catch (error) {
      console.error('❌ [WebinarRepository] Erro ao listar webinars ativos:', error);
      return [];
    }
  }

  async updateStatus(id: string, status: WebinarStatus): Promise<void> {
    try {
      await this.col.doc(id).set({ status }, { merge: true });
    } catch (error) {
      console.error(`❌ [WebinarRepository] Erro ao atualizar status de ${id}:`, error);
    }
  }

  /** Helper para seed/admin: cria ou atualiza um webinar. */
  async upsert(webinar: Webinar): Promise<void> {
    try {
      await this.col.doc(webinar.id).set(
        {
          tema: webinar.tema,
          dataHora: admin.firestore.Timestamp.fromDate(webinar.dataHora),
          palestrante: webinar.palestrante,
          linkSala: webinar.linkSala,
          status: webinar.status,
        },
        { merge: true }
      );
    } catch (error) {
      console.error(`❌ [WebinarRepository] Erro ao salvar webinar ${webinar.id}:`, error);
    }
  }
}

export default new WebinarRepository();
