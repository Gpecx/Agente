import * as admin from 'firebase-admin';
import { firebaseApp } from '../../config/firebase';
import { sparkConfig } from '../config/sparkConfig';

class SparkAdminRepository {
  private readonly COLLECTION = 'spark_admins';

  private get db(): admin.firestore.Firestore {
    return firebaseApp.firestore();
  }

  private docId(jid: string): string {
    return jid.replace(/\//g, '_');
  }

  async list(): Promise<string[]> {
    try {
      const snap = await this.db.collection(this.COLLECTION).get();
      const firestoreAdmins = snap.docs.map((doc) => doc.id);
      return Array.from(new Set([...sparkConfig.adminJids, ...firestoreAdmins])).sort();
    } catch (error) {
      console.error('❌ [SparkAdminRepository] Erro ao listar admins:', error);
      return sparkConfig.adminJids;
    }
  }

  async add(jid: string): Promise<void> {
    await this.db.collection(this.COLLECTION).doc(this.docId(jid)).set({
      jid,
      addedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  async remove(jid: string): Promise<void> {
    await this.db.collection(this.COLLECTION).doc(this.docId(jid)).delete();
  }

  async isAdmin(jid: string): Promise<boolean> {
    if (sparkConfig.adminJids.includes(jid)) return true;
    try {
      const snap = await this.db.collection(this.COLLECTION).doc(this.docId(jid)).get();
      return snap.exists;
    } catch (error) {
      console.error(`❌ [SparkAdminRepository] Erro ao consultar admin ${jid}:`, error);
      return false;
    }
  }
}

export default new SparkAdminRepository();
