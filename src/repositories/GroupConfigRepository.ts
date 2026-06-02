import * as admin from 'firebase-admin';
import { firebaseApp } from '../config/firebase';

/**
 * Repositório responsável pela Whitelist de Grupos.
 * Utiliza cache em memória para zerar a latência e evitar cobranças
 * abusivas de "document reads" no Firestore a cada mensagem recebida.
 */
class GroupConfigRepository {
  private allowedGroupsCache: Set<string> = new Set();
  private isCacheInitialized = false;

  constructor() {
    // Inicializa o cache assim que a classe é instanciada no boot do servidor
    this.syncCache();
    
    // Auto-atualização silenciosa a cada 5 minutos
    setInterval(() => this.syncCache(), 5 * 60 * 1000);
  }

  private get db(): admin.firestore.Firestore {
    return firebaseApp.firestore();
  }

  /**
   * Puxa todos os IDs de grupos autorizados da coleção "allowed_groups" no Firestore
   * e os armazena no cache local em memória (Set).
   */
  private async syncCache(): Promise<void> {
    try {
      const snapshot = await this.db.collection('allowed_groups').get();
      const newCache = new Set<string>();

      snapshot.forEach(doc => {
        newCache.add(doc.id); // O ID do documento é o próprio remoteJid (ex: 1203630...@g.us)
      });

      // Substituição atômica na memória
      this.allowedGroupsCache = newCache;
      this.isCacheInitialized = true;
      console.log(`🔄 [GroupConfig] Cache atualizado. Moderação ativa em ${this.allowedGroupsCache.size} grupo(s).`);
    } catch (error) {
      console.error('❌ [GroupConfig] Falha crítica ao tentar sincronizar os grupos autorizados do Firestore:', error);
      // Mantemos o cache antigo em caso de queda de rede com o GCP
    }
  }

  /**
   * Adiciona um grupo à whitelist (coleção `allowed_groups`) e atualiza o cache
   * imediatamente, para a moderação passar a valer sem esperar o sync de 5 min.
   */
  public async addGroup(remoteJid: string): Promise<void> {
    await this.db.collection('allowed_groups').doc(remoteJid).set({
      addedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    this.allowedGroupsCache.add(remoteJid);
    console.log(`✅ [GroupConfig] Grupo ${remoteJid} liberado na whitelist.`);
  }

  /** Remove um grupo da whitelist e atualiza o cache imediatamente. */
  public async removeGroup(remoteJid: string): Promise<void> {
    await this.db.collection('allowed_groups').doc(remoteJid).delete();
    this.allowedGroupsCache.delete(remoteJid);
    console.log(`🗑️ [GroupConfig] Grupo ${remoteJid} removido da whitelist.`);
  }

  /** Lista os grupos atualmente liberados (lê do Firestore, fonte da verdade). */
  public async listGroups(): Promise<string[]> {
    const snapshot = await this.db.collection('allowed_groups').get();
    return snapshot.docs.map((doc) => doc.id);
  }

  /**
   * Avalia em O(1) se o grupo consta na Whitelist.
   * Método chamado em 100% dos webhooks, precisa ser ultrarrápido.
   */
  public async isGroupAllowed(remoteJid: string): Promise<boolean> {
    if (!remoteJid) return false;

    // Condição de corrida no boot: se chegar webhook antes da primeira query terminar, faz query direta
    if (!this.isCacheInitialized) {
      try {
        const doc = await this.db.collection('allowed_groups').doc(remoteJid).get();
        if (doc.exists) {
          this.allowedGroupsCache.add(remoteJid);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    }

    // Busca O(1) nativa do Set do TypeScript (sem tocar no banco de dados)
    return this.allowedGroupsCache.has(remoteJid);
  }
}

// Exporta como Singleton para o cache ser compartilhado globalmente
export default new GroupConfigRepository();
