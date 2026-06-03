import * as admin from 'firebase-admin';
import { firebaseApp } from '../../config/firebase';
import { TriagemCandidate, TriagemStatus, TriagemTurn } from '../interfaces/triagem.interface';

/**
 * Estado de cada candidato no funil de triagem (1 doc por JID em
 * `triagem_candidatos/{jid}`): status, histórico da conversa e veredito.
 */
class TriagemCandidateRepository {
  private readonly COLLECTION = 'triagem_candidatos';

  private get db(): admin.firestore.Firestore {
    return firebaseApp.firestore();
  }

  /** O JID contém caracteres ('@', '.') válidos como doc id no Firestore, mas evitamos '/'. */
  private docId(jid: string): string {
    return jid.replace(/\//g, '_');
  }

  /** Busca o candidato; retorna null se ainda não existe. */
  public async get(jid: string): Promise<TriagemCandidate | null> {
    const snap = await this.db.collection(this.COLLECTION).doc(this.docId(jid)).get();
    if (!snap.exists) return null;
    const d = snap.data() as any;
    return {
      jid,
      pushName: d.pushName || '',
      status: (d.status as TriagemStatus) || 'em_andamento',
      history: Array.isArray(d.history) ? (d.history as TriagemTurn[]) : [],
      turns: typeof d.turns === 'number' ? d.turns : 0,
      veredito: d.veredito,
      justificativa: d.justificativa,
      score: typeof d.score === 'number' ? d.score : undefined,
    };
  }

  /** Cria um candidato novo em estado `em_andamento`. */
  public async create(jid: string, pushName: string): Promise<TriagemCandidate> {
    const candidate: TriagemCandidate = {
      jid,
      pushName,
      status: 'em_andamento',
      history: [],
      turns: 0,
    };
    await this.db.collection(this.COLLECTION).doc(this.docId(jid)).set({
      ...candidate,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return candidate;
  }

  /** Persiste mudanças parciais do candidato. */
  public async save(jid: string, patch: Partial<TriagemCandidate>): Promise<void> {
    await this.db.collection(this.COLLECTION).doc(this.docId(jid)).set(
      { ...patch, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
  }
}

export default new TriagemCandidateRepository();
