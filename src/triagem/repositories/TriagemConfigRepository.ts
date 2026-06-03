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
        [
          'Aprove quem tem o perfil do público dos webinars de SPCS:',
          '- atua ou estuda na área elétrica/energia, em especial proteção, controle e supervisão ' +
            '(relés, subestações, automação, IEC 61850/GOOSE, testes de proteção, teleproteção, ' +
            'concessionárias/integradoras); ou',
          '- é estudante de engenharia elétrica / técnico em eletrotécnica com interesse genuíno; ou',
          '- é gestor do setor elétrico interessado no conteúdo.',
          'Sinais positivos: cita relés (SEL, Siemens, ABB, Pextron, Woodward), funções de proteção ' +
            '(67, 79, diferencial), GOOSE, TC, teleproteção, ou descreve trabalho em subestação/proteção.',
          'Reprove: spam/divulgação, vendedores buscando clientes, ou pessoas sem relação com o setor ' +
            'elétrico e sem interesse real.',
          'Use "duvida" quando a pessoa for educada e possivelmente do setor, mas a área/intenção ' +
            'ficar ambígua mesmo após perguntar.',
        ].join('\n'),
      contexto:
        process.env.TRIAGEM_CONTEXTO ||
        'Série "GPECx 12 Anos" — 12 webinars técnicos gratuitos sobre SPCS (Sistemas de Proteção, ' +
          'Controle e Supervisão) do setor elétrico. Temas: lógicas em relés (SEL/Siemens/ABB), proteção ' +
          'direcional 67, GOOSE/IEC 61850, testes de TC, teleproteção, religamento 79, simuladores e IA ' +
          'aplicada a SPCS. Público: técnicos, engenheiros e gestores de proteção/controle/supervisão e ' +
          'estudantes de engenharia elétrica.',
      nomeGrupo: process.env.TRIAGEM_NOME_GRUPO || 'Webinars GPECx (SPCS)',
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
