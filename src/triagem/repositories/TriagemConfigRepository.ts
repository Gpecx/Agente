import * as admin from 'firebase-admin';
import { firebaseApp } from '../../config/firebase';
import { TriagemConfig } from '../interfaces/triagem.interface';

/**
 * Configuração da triagem (requisitos/contexto/nome do grupo), editável em
 * runtime via endpoint admin (sem redeploy — ótimo para tunar o diálogo).
 *
 * Fonte: doc `triagem_config/default` no Firestore, com fallback para envs e um
 * default placeholder. Cache de 1min para não ler o Firestore a cada DM.
 */
class TriagemConfigRepository {
  private readonly DOC = 'triagem_config/default';
  private cache?: TriagemConfig;
  private cacheAt = 0;
  private readonly TTL_MS = 60 * 1000;

  private get db(): admin.firestore.Firestore {
    return firebaseApp.firestore();
  }

  private get defaults(): TriagemConfig {
    return {
      requisitos:
        process.env.TRIAGEM_REQUISITOS ||
        'Placeholder — edite via POST /api/admin/triagem/config. Exemplo: o candidato ' +
          'deve atuar na área de tecnologia, ter interesse genuíno na comunidade e não ser ' +
          'concorrente direto. Recuse perfis de spam/divulgação.',
      contexto:
        process.env.TRIAGEM_CONTEXTO ||
        'Grupo profissional de networking e troca de conhecimento.',
      nomeGrupo: process.env.TRIAGEM_NOME_GRUPO || 'nosso grupo',
    };
  }

  /** Retorna a config atual (Firestore sobrepõe os defaults), com cache curto. */
  public async get(agora = Date.now()): Promise<TriagemConfig> {
    if (this.cache && agora - this.cacheAt < this.TTL_MS) return this.cache;

    try {
      const snap = await this.db.doc(this.DOC).get();
      const data = (snap.exists ? snap.data() : {}) || {};
      const d = this.defaults;
      this.cache = {
        requisitos: typeof data.requisitos === 'string' && data.requisitos.trim() ? data.requisitos : d.requisitos,
        contexto: typeof data.contexto === 'string' && data.contexto.trim() ? data.contexto : d.contexto,
        nomeGrupo: typeof data.nomeGrupo === 'string' && data.nomeGrupo.trim() ? data.nomeGrupo : d.nomeGrupo,
      };
      this.cacheAt = agora;
      return this.cache;
    } catch (error) {
      console.error('❌ [TriagemConfig] Erro ao ler config — usando defaults:', error);
      return this.defaults;
    }
  }

  /** Atualiza campos da config e invalida o cache imediatamente. */
  public async update(patch: Partial<TriagemConfig>): Promise<TriagemConfig> {
    const limpo: Record<string, string> = {};
    for (const k of ['requisitos', 'contexto', 'nomeGrupo'] as const) {
      const v = patch[k];
      if (typeof v === 'string' && v.trim()) limpo[k] = v.trim();
    }
    await this.db.doc(this.DOC).set(
      { ...limpo, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    this.cache = undefined; // força releitura no próximo get()
    return this.get(Date.now() + this.TTL_MS + 1);
  }
}

export default new TriagemConfigRepository();
