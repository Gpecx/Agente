import * as admin from 'firebase-admin';
import { firebaseApp } from '../config/firebase';
import evolutionApiService from './EvolutionApiService';

/**
 * Posta UMA única vez por grupo um aviso de transparência informando que as
 * conversas são analisadas para gerar relatórios internos (resumo mensal).
 *
 * Requisito de privacidade/LGPD alinhado: gravar e resumir o que os membros
 * falam exige transparência mínima. O estado "já avisado" é persistido em
 * `summary_config/{groupJid}` e cacheado em memória para evitar uma leitura no
 * Firestore a cada mensagem.
 *
 * Desligável com SUMMARY_NOTICE_ENABLED=false.
 */
class SummaryNoticeService {
  private readonly COLLECTION = 'summary_config';
  /** Grupos já avisados nesta instância de processo (evita ler o Firestore toda hora). */
  private readonly cache = new Set<string>();

  private get db(): admin.firestore.Firestore {
    return firebaseApp.firestore();
  }

  private get enabled(): boolean {
    return process.env.SUMMARY_NOTICE_ENABLED !== 'false';
  }

  private get noticeText(): string {
    return (
      process.env.SUMMARY_NOTICE_TEXT ||
      'ℹ️ *Aviso de transparência:* as conversas deste grupo são analisadas de forma ' +
        'automatizada para gerar relatórios internos mensais (assuntos discutidos e dúvidas ' +
        'frequentes). Nenhuma mensagem é compartilhada fora da administração.'
    );
  }

  /**
   * Garante que o aviso foi postado no grupo. Idempotente e fire-and-forget:
   * qualquer erro é logado, nunca propagado.
   */
  public async ensureNotice(instance: string, groupJid: string): Promise<void> {
    if (!this.enabled || this.cache.has(groupJid)) return;

    try {
      const ref = this.db.collection(this.COLLECTION).doc(groupJid);
      const snap = await ref.get();

      if (snap.exists && snap.data()?.noticePostedAt) {
        this.cache.add(groupJid); // já avisado em execução anterior
        return;
      }

      await evolutionApiService.sendText(instance, groupJid, this.noticeText);
      await ref.set(
        { noticePostedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      this.cache.add(groupJid);
      console.log(`📢 [SummaryNotice] Aviso de transparência postado em ${groupJid}.`);
    } catch (error) {
      console.error('❌ [SummaryNotice] Falha ao postar aviso de transparência:', error);
    }
  }
}

export default new SummaryNoticeService();
