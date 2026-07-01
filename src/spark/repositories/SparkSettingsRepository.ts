import * as admin from 'firebase-admin';
import { firebaseApp } from '../../config/firebase';
import { sparkConfig } from '../config/sparkConfig';

export interface SparkRuntimeSettings {
  dmEnabled: boolean;
  groupJid: string;
}

class SparkSettingsRepository {
  private readonly DOC = 'spark_config/runtime';
  private cache?: SparkRuntimeSettings;
  private cacheAt = 0;
  private readonly TTL_MS = 30 * 1000;

  private get db(): admin.firestore.Firestore {
    return firebaseApp.firestore();
  }

  private get defaults(): SparkRuntimeSettings {
    return {
      dmEnabled: sparkConfig.dmEnabled,
      groupJid: sparkConfig.groupJid,
    };
  }

  async get(agora = Date.now()): Promise<SparkRuntimeSettings> {
    if (this.cache && agora - this.cacheAt < this.TTL_MS) return this.cache;

    try {
      const snap = await this.db.doc(this.DOC).get();
      const data = (snap.exists ? snap.data() : {}) || {};
      const defaults = this.defaults;

      this.cache = {
        dmEnabled: typeof data.dmEnabled === 'boolean' ? data.dmEnabled : defaults.dmEnabled,
        groupJid: typeof data.groupJid === 'string' ? data.groupJid.trim() : defaults.groupJid,
      };
      this.cacheAt = agora;
      return this.cache;
    } catch (error) {
      console.error('❌ [SparkSettingsRepository] Erro ao ler config Spark runtime:', error);
      return this.defaults;
    }
  }

  async update(patch: Partial<SparkRuntimeSettings>): Promise<SparkRuntimeSettings> {
    const clean: Partial<SparkRuntimeSettings> = {};

    if (typeof patch.dmEnabled === 'boolean') {
      clean.dmEnabled = patch.dmEnabled;
    }

    if (typeof patch.groupJid === 'string') {
      clean.groupJid = patch.groupJid.trim();
    }

    await this.db.doc(this.DOC).set(
      {
        ...clean,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    this.cache = undefined;
    return this.get(Date.now() + this.TTL_MS + 1);
  }
}

export default new SparkSettingsRepository();
