import * as admin from 'firebase-admin';
import { firebaseApp } from '../../config/firebase';

/**
 * Repositório de idempotência dos gatilhos de cron (spec §7).
 *
 * Doc id = `${webinarId}:${gatilho}`. Antes de executar uma ação proativa
 * (ex.: postar teaser de D-1), o scheduler chama `marcarSeInedito()`: se o
 * documento já existe, a ação NÃO deve rodar de novo.
 */
class CronExecRepository {
  private get db(): admin.firestore.Firestore {
    return firebaseApp.firestore();
  }

  private get col(): admin.firestore.CollectionReference {
    return this.db.collection('cron_exec');
  }

  private docId(webinarId: string, gatilho: string): string {
    return `${webinarId}:${gatilho}`;
  }

  /**
   * Marca o gatilho como executado de forma atômica.
   * @returns true se ESTE chamador "ganhou" a execução (era inédito);
   *          false se já havia sido executado antes (deve pular).
   */
  async marcarSeInedito(webinarId: string, gatilho: string): Promise<boolean> {
    const ref = this.col.doc(this.docId(webinarId, gatilho));
    try {
      // Transação garante atomicidade contra execuções concorrentes do cron.
      return await this.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) {
          return false; // já executado
        }
        tx.set(ref, {
          webinarId,
          gatilho,
          executadoEm: admin.firestore.FieldValue.serverTimestamp(),
        });
        return true;
      });
    } catch (error) {
      console.error(
        `❌ [CronExecRepository] Erro ao marcar gatilho ${gatilho} de ${webinarId}:`,
        error
      );
      // Em caso de falha do banco, retorna false para EVITAR duplicação de posts.
      return false;
    }
  }

  async jaExecutou(webinarId: string, gatilho: string): Promise<boolean> {
    try {
      const doc = await this.col.doc(this.docId(webinarId, gatilho)).get();
      return doc.exists;
    } catch (error) {
      console.error('❌ [CronExecRepository] Erro ao consultar execução:', error);
      return false;
    }
  }
}

export default new CronExecRepository();
