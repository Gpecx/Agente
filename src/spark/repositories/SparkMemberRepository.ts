import * as admin from 'firebase-admin';
import { firebaseApp } from '../../config/firebase';
import {
  SparkMember,
  SparkGeneratedKey,
  SparkPendingFlow,
  SparkSegmento,
  SparkUsageLevel,
} from '../interfaces/spark.interface';

class SparkMemberRepository {
  private readonly COLLECTION = 'spark_members';

  private get db(): admin.firestore.Firestore {
    return firebaseApp.firestore();
  }

  private docId(jid: string): string {
    return jid.replace(/\//g, '_');
  }

  private tsToDate(value: any): Date | undefined {
    if (!value) return undefined;
    if (typeof value.toDate === 'function') return value.toDate();
    return value instanceof Date ? value : undefined;
  }

  private parseGeneratedKeys(value: any): SparkGeneratedKey[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item) => item && typeof item.code === 'string' && typeof item.type === 'string')
      .map((item) => ({
        type: item.type,
        code: item.code,
        createdAt: this.tsToDate(item.createdAt),
        reason: typeof item.reason === 'string' ? item.reason : undefined,
        challengeId: typeof item.challengeId === 'string' ? item.challengeId : undefined,
      }));
  }

  private fromDoc(jid: string, data: any): SparkMember {
    return {
      jid,
      pushName: data.pushName || '',
      segmento: (data.segmento as SparkSegmento) || 'A',
      hasExistingKey: typeof data.hasExistingKey === 'boolean' ? data.hasExistingKey : undefined,
      temChave: !!data.temChave,
      chaveEntregueEm: this.tsToDate(data.chaveEntregueEm),
      usageLevel: (data.usageLevel as SparkUsageLevel) || 'unknown',
      appUsageCount: Number.isFinite(Number(data.appUsageCount)) ? Number(data.appUsageCount) : 0,
      joinedAt: this.tsToDate(data.joinedAt),
      lastInteractionAt: this.tsToDate(data.lastInteractionAt),
      lastMenuAt: this.tsToDate(data.lastMenuAt),
      lastChallengeAnswerAt: this.tsToDate(data.lastChallengeAnswerAt),
      trialEndsAt: this.tsToDate(data.trialEndsAt),
      lastInactivityPromptAt: this.tsToDate(data.lastInactivityPromptAt),
      lastExpiryPromptAt: this.tsToDate(data.lastExpiryPromptAt),
      pendingFlow: (data.pendingFlow as SparkPendingFlow) || null,
      challengeWeeks: Array.isArray(data.challengeWeeks) ? data.challengeWeeks : [],
      lastBonusWeekSent: typeof data.lastBonusWeekSent === 'string' ? data.lastBonusWeekSent : undefined,
      generatedKeys: this.parseGeneratedKeys(data.generatedKeys),
    };
  }

  async get(jid: string): Promise<SparkMember | null> {
    try {
      const snap = await this.db.collection(this.COLLECTION).doc(this.docId(jid)).get();
      if (!snap.exists) return null;
      return this.fromDoc(jid, snap.data());
    } catch (error) {
      console.error(`❌ [SparkMemberRepository] Erro ao buscar ${jid}:`, error);
      return null;
    }
  }

  async list(limit = 100): Promise<SparkMember[]> {
    try {
      const snap = await this.db
        .collection(this.COLLECTION)
        .orderBy('updatedAt', 'desc')
        .limit(limit)
        .get();
      return snap.docs.map((doc) => this.fromDoc(doc.id, doc.data()));
    } catch (error) {
      console.error('❌ [SparkMemberRepository] Erro ao listar membros:', error);
      return [];
    }
  }

  async ensure(
    jid: string,
    pushName: string,
    segmento: SparkSegmento,
    trialEndsAt: Date
  ): Promise<SparkMember> {
    const ref = this.db.collection(this.COLLECTION).doc(this.docId(jid));
    const now = new Date();

    try {
      await this.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) {
          tx.set(ref, {
            jid,
            pushName,
            segmento,
            hasExistingKey: null,
            temChave: false,
            usageLevel: 'unknown',
            appUsageCount: 0,
            pendingFlow: null,
            challengeWeeks: [],
            generatedKeys: [],
            joinedAt: admin.firestore.Timestamp.fromDate(now),
            lastInteractionAt: admin.firestore.Timestamp.fromDate(now),
            trialEndsAt: admin.firestore.Timestamp.fromDate(trialEndsAt),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          return;
        }

        tx.set(
          ref,
          {
            pushName: pushName || snap.data()?.pushName || '',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      });
    } catch (error) {
      console.error(`❌ [SparkMemberRepository] Erro ao garantir ${jid}:`, error);
    }

    return (
      (await this.get(jid)) || {
        jid,
        pushName,
        segmento,
        hasExistingKey: undefined,
        temChave: false,
        usageLevel: 'unknown',
        appUsageCount: 0,
        pendingFlow: null,
        generatedKeys: [],
        joinedAt: now,
        lastInteractionAt: now,
        trialEndsAt,
      }
    );
  }

  async save(jid: string, patch: Record<string, any>): Promise<void> {
    try {
      await this.db.collection(this.COLLECTION).doc(this.docId(jid)).set(
        { ...patch, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    } catch (error) {
      console.error(`❌ [SparkMemberRepository] Erro ao salvar ${jid}:`, error);
    }
  }

  async touchInteraction(
    jid: string,
    pushName?: string,
    opts: { clearPending?: boolean } = {}
  ): Promise<void> {
    const patch: Record<string, any> = {
      lastInteractionAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (opts.clearPending !== false) patch.pendingFlow = null;
    if (pushName) patch.pushName = pushName;
    await this.save(jid, patch);
  }

  async markKeyDelivered(jid: string): Promise<void> {
    await this.save(jid, {
      temChave: true,
      chaveEntregueEm: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  async markMenuSent(jid: string): Promise<void> {
    await this.save(jid, {
      lastMenuAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  async setAppUsageCount(jid: string, appUsageCount: number): Promise<void> {
    await this.save(jid, {
      appUsageCount: Math.max(0, Math.floor(appUsageCount)),
    });
  }

  async addGeneratedKey(jid: string, key: Omit<SparkGeneratedKey, 'createdAt'>): Promise<void> {
    await this.save(jid, {
      generatedKeys: admin.firestore.FieldValue.arrayUnion({
        ...key,
        createdAt: admin.firestore.Timestamp.fromDate(new Date()),
      }),
    });
  }

  async setPendingFlow(jid: string, pendingFlow: SparkPendingFlow): Promise<void> {
    await this.save(jid, { pendingFlow });
  }

  async setUsageLevel(jid: string, usageLevel: SparkUsageLevel): Promise<void> {
    await this.save(jid, { usageLevel });
  }

  async markChallengeParticipation(jid: string, weekKey: string): Promise<void> {
    await this.save(jid, {
      challengeWeeks: admin.firestore.FieldValue.arrayUnion(weekKey),
      lastChallengeAnswerAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  async listChallengeParticipants(weekKey: string): Promise<SparkMember[]> {
    try {
      const snap = await this.db
        .collection(this.COLLECTION)
        .where('challengeWeeks', 'array-contains', weekKey)
        .get();
      return snap.docs.map((doc) => this.fromDoc(doc.id, doc.data()));
    } catch (error) {
      console.error('❌ [SparkMemberRepository] Erro ao listar participantes do desafio:', error);
      return [];
    }
  }

  async markBonusSent(jid: string, weekKey: string): Promise<void> {
    await this.save(jid, { lastBonusWeekSent: weekKey });
  }

  async listDueInactivity(cutoff: Date): Promise<SparkMember[]> {
    try {
      const snap = await this.db
        .collection(this.COLLECTION)
        .where('lastInteractionAt', '<=', admin.firestore.Timestamp.fromDate(cutoff))
        .get();
      return snap.docs
        .map((doc) => this.fromDoc(doc.id, doc.data()))
        .filter((member) => {
          const lastPrompt = member.lastInactivityPromptAt?.getTime() || 0;
          const lastInteraction = member.lastInteractionAt?.getTime() || 0;
          return lastPrompt < lastInteraction;
        });
    } catch (error) {
      console.error('❌ [SparkMemberRepository] Erro ao listar inativos:', error);
      return [];
    }
  }

  async markInactivityPrompt(jid: string): Promise<void> {
    await this.save(jid, {
      lastInactivityPromptAt: admin.firestore.FieldValue.serverTimestamp(),
      pendingFlow: 'technical_question',
    });
  }

  async listDueExpiry(windowStart: Date, windowEnd: Date): Promise<SparkMember[]> {
    try {
      const snap = await this.db
        .collection(this.COLLECTION)
        .where('trialEndsAt', '>=', admin.firestore.Timestamp.fromDate(windowStart))
        .where('trialEndsAt', '<=', admin.firestore.Timestamp.fromDate(windowEnd))
        .get();
      return snap.docs
        .map((doc) => this.fromDoc(doc.id, doc.data()))
        .filter((member) => {
          const lastPrompt = member.lastExpiryPromptAt?.getTime() || 0;
          const trialEndsAt = member.trialEndsAt?.getTime() || 0;
          return trialEndsAt > lastPrompt;
        });
    } catch (error) {
      console.error('❌ [SparkMemberRepository] Erro ao listar expiracoes:', error);
      return [];
    }
  }

  async markExpiryPrompt(jid: string, pendingFlow: SparkPendingFlow = 'low_usage_diagnosis'): Promise<void> {
    const patch: Record<string, any> = {
      lastExpiryPromptAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    patch.pendingFlow = pendingFlow;
    await this.save(jid, patch);
  }
}

export default new SparkMemberRepository();
