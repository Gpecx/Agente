import * as admin from 'firebase-admin';
import { firebaseApp } from '../config/firebase';

/** Mensagem arquivada (apenas texto) usada para gerar o resumo mensal. */
export interface ArchivedMessage {
  groupJid: string;
  participantJid: string;
  pushName: string;
  text: string;
  messageId: string;
  /** Data/hora real da mensagem (vinda do WhatsApp). */
  ts: Date;
}

/** Parâmetros para arquivar uma mensagem recém-recebida. */
export interface ArchiveParams {
  groupJid: string;
  participantJid: string;
  pushName?: string;
  text: string;
  messageId: string;
  /** messageTimestamp da Evolution (em SEGUNDOS). Se ausente, usa "agora". */
  messageTimestamp?: number;
}

/**
 * Persiste o histórico de mensagens de texto dos grupos para que o resumo
 * mensal (ConversationSummaryService) possa ser gerado.
 *
 * ⚠️ O bot historicamente NÃO guardava mensagens — só moderava e descartava.
 * Esta coleção começa a valer a partir do deploy; não há histórico retroativo.
 *
 * Coleção: `mensagens` (1 doc por mensagem de texto).
 */
class MessageArchiveRepository {
  private readonly COLLECTION = 'mensagens';

  private get db(): admin.firestore.Firestore {
    return firebaseApp.firestore();
  }

  /**
   * Grava uma mensagem de texto. Fire-and-forget: erros são logados mas nunca
   * propagados, para não travar a esteira de webhook (mesmo padrão do
   * AuditRepository).
   */
  public async archive(params: ArchiveParams): Promise<void> {
    try {
      const data =
        typeof params.messageTimestamp === 'number' && params.messageTimestamp > 0
          ? new Date(params.messageTimestamp * 1000)
          : new Date();

      await this.db.collection(this.COLLECTION).add({
        groupJid: params.groupJid,
        participantJid: params.participantJid,
        pushName: params.pushName || '',
        text: params.text,
        messageId: params.messageId,
        ts: admin.firestore.Timestamp.fromDate(data),
        // Campo de partição "AAAA-MM": permite consultar o mês com DOIS filtros de
        // igualdade (groupJid + period), que o Firestore serve via merge join de
        // índices de campo único — sem exigir índice COMPOSTO.
        period: MessageArchiveRepository.toPeriod(data),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.error('❌ [MessageArchive] Erro ao arquivar mensagem:', error);
      // Falha silenciosa — arquivamento nunca pode quebrar a moderação.
    }
  }

  /** Converte uma data para a chave de partição "AAAA-MM" (mês civil, hora local). */
  public static toPeriod(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Retorna as mensagens de um grupo num mês civil (AAAA-MM), ordenadas por ts.
   *
   * Usa dois filtros de igualdade (groupJid + period) — servidos pelo Firestore
   * sem índice COMPOSTO. A ordenação por ts é feita em memória (o volume de um
   * mês de um grupo é limitado).
   *
   * @param limite Teto de mensagens lidas (proteção de custo/memória). Se atingido,
   *               loga o truncamento (sem cortar silenciosamente).
   */
  public async getMonth(
    groupJid: string,
    ano: number,
    mes: number,
    limite = 5000
  ): Promise<ArchivedMessage[]> {
    const period = `${ano}-${String(mes).padStart(2, '0')}`;

    const snapshot = await this.db
      .collection(this.COLLECTION)
      .where('groupJid', '==', groupJid)
      .where('period', '==', period)
      .limit(limite)
      .get();

    if (snapshot.size >= limite) {
      console.warn(
        `⚠️ [MessageArchive] Limite de ${limite} mensagens atingido para ${groupJid} em ${period} — ` +
          `o resumo pode não cobrir o mês inteiro. Aumente o teto se necessário.`
      );
    }

    return snapshot.docs
      .map((doc) => {
        const d = doc.data();
        return {
          groupJid: d.groupJid,
          participantJid: d.participantJid,
          pushName: d.pushName || '',
          text: d.text || '',
          messageId: d.messageId || '',
          ts: (d.ts as admin.firestore.Timestamp)?.toDate?.() ?? new Date(),
        };
      })
      .sort((a, b) => a.ts.getTime() - b.ts.getTime());
  }
}

export default new MessageArchiveRepository();
