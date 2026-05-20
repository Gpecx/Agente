import * as admin from 'firebase-admin';
import { firebaseApp } from '../config/firebase';

// Prompt de fallback utilizado caso o Firestore esteja vazio ou inacessível
const DEFAULT_BEHAVIORAL_PROMPT = `Você é um bot moderador rigoroso e invisível de um grupo de WhatsApp.
Analise a seguinte mensagem meticulosamente em busca de:
1. Discurso de ódio, preconceito ou ofensas graves.
2. Spam, propagandas não autorizadas, correntes longas ou phishing.
3. Links altamente ofuscados ou disfarçados maliciosamente no contexto.

Se a mensagem for inofensiva ou uma conversa normal, "isInfraction" deve ser falso.
Se for uma infração, "isInfraction" deve ser verdadeiro e "reason" deve explicar brevemente o motivo.`;

/**
 * Repositório responsável por gerenciar o prompt comportamental do Gemini no Firestore.
 * Utiliza Cache em Memória com TTL de 10 minutos para evitar leituras excessivas no banco.
 */
class PromptRepository {
  private cachedPrompt: string | null = null;
  private cacheTimestamp = 0;
  private readonly CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos

  private get db(): admin.firestore.Firestore {
    return firebaseApp.firestore();
  }

  /**
   * Referência fixa do documento no Firestore: settings/gemini_prompt
   */
  private get promptDocRef(): admin.firestore.DocumentReference {
    return this.db.collection('settings').doc('gemini_prompt');
  }

  /**
   * Verifica se o cache local ainda está válido dentro do TTL.
   */
  private isCacheValid(): boolean {
    return this.cachedPrompt !== null && (Date.now() - this.cacheTimestamp < this.CACHE_TTL_MS);
  }

  /**
   * Retorna o prompt comportamental do Gemini.
   * Prioridade: Cache em memória → Firestore → Fallback hardcoded.
   */
  public async getBehavioralPrompt(): Promise<string> {
    // 1. Retorna do cache se ainda válido (O(1), zero custo GCP)
    if (this.isCacheValid()) {
      return this.cachedPrompt!;
    }

    // 2. Tenta buscar do Firestore
    try {
      const doc = await this.promptDocRef.get();

      if (doc.exists) {
        const data = doc.data();
        const promptText = data?.text as string | undefined;

        if (promptText && promptText.trim().length > 0) {
          this.cachedPrompt = promptText;
          this.cacheTimestamp = Date.now();
          console.log('📝 [PromptRepository] Prompt comportamental carregado do Firestore.');
          return this.cachedPrompt;
        }
      }
    } catch (error) {
      console.error('❌ [PromptRepository] Falha ao buscar prompt do Firestore:', error);
    }

    // 3. Fallback seguro: usa o prompt padrão embutido
    console.log('ℹ️ [PromptRepository] Usando prompt padrão (fallback).');
    this.cachedPrompt = DEFAULT_BEHAVIORAL_PROMPT;
    this.cacheTimestamp = Date.now();
    return this.cachedPrompt;
  }

  /**
   * Atualiza o prompt comportamental no Firestore e invalida o cache imediatamente.
   */
  public async updateBehavioralPrompt(newText: string): Promise<void> {
    await this.promptDocRef.set(
      {
        text: newText,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // Invalida o cache para que a próxima leitura já traga o texto novo
    this.cachedPrompt = newText;
    this.cacheTimestamp = Date.now();

    console.log('✅ [PromptRepository] Prompt comportamental atualizado no Firestore e cache renovado.');
  }
}

export default new PromptRepository();
