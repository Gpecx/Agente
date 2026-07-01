import * as admin from 'firebase-admin';
import { firebaseApp } from '../../config/firebase';
import {
  SparkChallenge,
  SparkChallengeAnswer,
  SparkChallengeOption,
  SparkChallengeStatus,
} from '../interfaces/spark.interface';

export interface SparkChallengeInput {
  id?: string;
  number?: number;
  weekKey: string;
  status?: SparkChallengeStatus;
  question: string;
  imageUrl?: string;
  options: Record<SparkChallengeOption, string>;
  correctOption: SparkChallengeOption;
  correctLabel: string;
  explanation: string;
}

class SparkChallengeRepository {
  private readonly CHALLENGES = 'spark_challenges';
  private readonly ANSWERS = 'spark_challenge_answers';

  private get db(): admin.firestore.Firestore {
    return firebaseApp.firestore();
  }

  private docId(value: string): string {
    return value.replace(/\//g, '_');
  }

  private answerDocId(challengeId: string, memberJid: string): string {
    return `${this.docId(challengeId)}__${this.docId(memberJid)}`;
  }

  private tsToDate(value: any): Date | undefined {
    if (!value) return undefined;
    if (typeof value.toDate === 'function') return value.toDate();
    return value instanceof Date ? value : undefined;
  }

  private fromChallengeDoc(doc: admin.firestore.DocumentSnapshot): SparkChallenge {
    const data = doc.data() || {};
    return {
      id: doc.id,
      number: Number(data.number) || 1,
      weekKey: data.weekKey || '',
      status: (data.status as SparkChallengeStatus) || 'draft',
      question: data.question || '',
      imageUrl: typeof data.imageUrl === 'string' ? data.imageUrl : undefined,
      options: data.options || { A: '', B: '', C: '', D: '' },
      correctOption: (data.correctOption as SparkChallengeOption) || 'A',
      correctLabel: data.correctLabel || '',
      explanation: data.explanation || '',
      createdAt: this.tsToDate(data.createdAt),
      publishedAt: this.tsToDate(data.publishedAt),
      answeredAt: this.tsToDate(data.answeredAt),
    };
  }

  private fromAnswerDoc(doc: admin.firestore.DocumentSnapshot): SparkChallengeAnswer {
    const data = doc.data() || {};
    return {
      id: doc.id,
      challengeId: data.challengeId || '',
      weekKey: data.weekKey || '',
      memberJid: data.memberJid || '',
      pushName: data.pushName || '',
      option: (data.option as SparkChallengeOption) || 'A',
      correct: !!data.correct,
      answeredAt: this.tsToDate(data.answeredAt),
      bonusKey: typeof data.bonusKey === 'string' ? data.bonusKey : undefined,
    };
  }

  async list(limit = 50): Promise<SparkChallenge[]> {
    try {
      const snap = await this.db
        .collection(this.CHALLENGES)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
      return snap.docs.map((doc) => this.fromChallengeDoc(doc));
    } catch (error) {
      console.error('❌ [SparkChallengeRepository] Erro ao listar desafios:', error);
      return [];
    }
  }

  async get(id: string): Promise<SparkChallenge | null> {
    try {
      const snap = await this.db.collection(this.CHALLENGES).doc(id).get();
      return snap.exists ? this.fromChallengeDoc(snap) : null;
    } catch (error) {
      console.error(`❌ [SparkChallengeRepository] Erro ao buscar desafio ${id}:`, error);
      return null;
    }
  }

  async upsert(input: SparkChallengeInput): Promise<SparkChallenge> {
    const ref = input.id
      ? this.db.collection(this.CHALLENGES).doc(input.id)
      : this.db.collection(this.CHALLENGES).doc();

    const existing = await ref.get();
    await ref.set(
      {
        ...input,
        status: input.status || (existing.data()?.status as SparkChallengeStatus) || 'draft',
        number: input.number || Number(existing.data()?.number) || (await this.nextNumber()),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(existing.exists ? {} : { createdAt: admin.firestore.FieldValue.serverTimestamp() }),
      },
      { merge: true }
    );

    return (await this.get(ref.id)) as SparkChallenge;
  }

  async nextNumber(): Promise<number> {
    try {
      const snap = await this.db
        .collection(this.CHALLENGES)
        .orderBy('number', 'desc')
        .limit(1)
        .get();
      const current = snap.docs[0]?.data()?.number;
      return Number.isFinite(Number(current)) ? Number(current) + 1 : 1;
    } catch {
      return 1;
    }
  }

  async findByWeekAndStatus(
    weekKey: string,
    status: SparkChallengeStatus
  ): Promise<SparkChallenge | null> {
    try {
      const snap = await this.db
        .collection(this.CHALLENGES)
        .where('weekKey', '==', weekKey)
        .where('status', '==', status)
        .limit(5)
        .get();
      const challenges = snap.docs.map((doc) => this.fromChallengeDoc(doc));
      return challenges.sort((a, b) => b.number - a.number)[0] || null;
    } catch (error) {
      console.error('❌ [SparkChallengeRepository] Erro ao buscar desafio por semana:', error);
      return null;
    }
  }

  async publish(id: string): Promise<SparkChallenge | null> {
    await this.db.collection(this.CHALLENGES).doc(id).set(
      {
        status: 'open',
        publishedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return this.get(id);
  }

  async markAnswered(id: string): Promise<SparkChallenge | null> {
    await this.db.collection(this.CHALLENGES).doc(id).set(
      {
        status: 'answered',
        answeredAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return this.get(id);
  }

  async recordAnswer(params: {
    challenge: SparkChallenge;
    memberJid: string;
    pushName: string;
    option: SparkChallengeOption;
  }): Promise<{ answer: SparkChallengeAnswer; created: boolean }> {
    const ref = this.db
      .collection(this.ANSWERS)
      .doc(this.answerDocId(params.challenge.id, params.memberJid));

    const correct = params.option === params.challenge.correctOption;
    let created = false;

    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return;
      created = true;
      tx.set(ref, {
        challengeId: params.challenge.id,
        weekKey: params.challenge.weekKey,
        memberJid: params.memberJid,
        pushName: params.pushName,
        option: params.option,
        correct,
        answeredAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    const snap = await ref.get();
    return { answer: this.fromAnswerDoc(snap), created };
  }

  async listAnswers(challengeId: string): Promise<SparkChallengeAnswer[]> {
    try {
      const snap = await this.db
        .collection(this.ANSWERS)
        .where('challengeId', '==', challengeId)
        .get();
      return snap.docs
        .map((doc) => this.fromAnswerDoc(doc))
        .sort((a, b) => (a.answeredAt?.getTime() || 0) - (b.answeredAt?.getTime() || 0));
    } catch (error) {
      console.error('❌ [SparkChallengeRepository] Erro ao listar respostas:', error);
      return [];
    }
  }

  async markBonus(answerId: string, bonusKey: string): Promise<void> {
    await this.db.collection(this.ANSWERS).doc(answerId).set(
      {
        bonusKey,
        bonusGeneratedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
}

export default new SparkChallengeRepository();
