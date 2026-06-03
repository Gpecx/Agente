import cron, { ScheduledTask } from 'node-cron';
import * as admin from 'firebase-admin';
import { firebaseApp } from '../config/firebase';
import groupConfigRepository from '../repositories/GroupConfigRepository';
import conversationSummaryService from './ConversationSummaryService';

/**
 * Dispara o resumo mensal das conversas de cada grupo liberado.
 *
 * Estratégia: um cron no dia 1 de cada mês (default 09:00, fuso do servidor)
 * gera o relatório do MÊS ANTERIOR e posta no ADMIN_GROUP_JID. A idempotência
 * (coleção `summary_runs`, doc `{groupJid}:{ano}-{mes}`) garante que, mesmo se o
 * processo reiniciar e o cron disparar de novo, o resumo de um mês não é
 * enviado em duplicidade.
 *
 * Desligável com SUMMARY_SCHEDULER_ENABLED=false.
 */
class MonthlySummaryScheduler {
  private task?: ScheduledTask;
  private readonly RUNS_COLLECTION = 'summary_runs';

  private get db(): admin.firestore.Firestore {
    return firebaseApp.firestore();
  }

  start(): void {
    if (process.env.SUMMARY_SCHEDULER_ENABLED === 'false') {
      console.log('⏸️ [MonthlySummary] Desabilitado (SUMMARY_SCHEDULER_ENABLED=false).');
      return;
    }

    // Default: dia 1, 09:00. Sobrescrevível por SUMMARY_CRON.
    const expr = process.env.SUMMARY_CRON || '0 9 1 * *';
    this.task = cron.schedule(expr, () => {
      this.run().catch((e) => console.error('❌ [MonthlySummary] Erro no disparo mensal:', e));
    });
    console.log(`🗓️ [MonthlySummary] Scheduler iniciado (cron "${expr}").`);
  }

  stop(): void {
    this.task?.stop();
  }

  /** Gera o resumo do mês anterior para todos os grupos liberados. */
  async run(agora: Date = new Date()): Promise<void> {
    const { ano, mes } = this.mesAnterior(agora);
    const instance = process.env.EVOLUTION_INSTANCE;

    if (!instance) {
      console.warn('⚠️ [MonthlySummary] EVOLUTION_INSTANCE não definido — não é possível postar.');
      return;
    }

    const grupos = await groupConfigRepository.listGroups();
    console.log(`🗓️ [MonthlySummary] Gerando resumo de ${mes}/${ano} para ${grupos.length} grupo(s).`);

    for (const groupJid of grupos) {
      try {
        if (!(await this.marcarSeInedito(groupJid, ano, mes))) {
          console.log(`↩️ [MonthlySummary] ${groupJid} ${mes}/${ano} já processado — pulando.`);
          continue;
        }
        await conversationSummaryService.gerarEEnviar(instance, groupJid, ano, mes);
      } catch (error) {
        console.error(`❌ [MonthlySummary] Falha ao resumir ${groupJid}:`, error);
      }
    }
  }

  /** Retorna ano/mês (1–12) do mês anterior ao informado. */
  private mesAnterior(agora: Date): { ano: number; mes: number } {
    const ano = agora.getMonth() === 0 ? agora.getFullYear() - 1 : agora.getFullYear();
    const mes = agora.getMonth() === 0 ? 12 : agora.getMonth(); // getMonth() é 0-based
    return { ano, mes };
  }

  /**
   * Marca a execução como feita de forma atômica (create falha se já existir).
   * @returns true se inédito (deve processar), false se já rodou.
   */
  private async marcarSeInedito(groupJid: string, ano: number, mes: number): Promise<boolean> {
    const ref = this.db.collection(this.RUNS_COLLECTION).doc(`${groupJid}:${ano}-${mes}`);
    try {
      await ref.create({ groupJid, ano, mes, ranAt: admin.firestore.FieldValue.serverTimestamp() });
      return true;
    } catch {
      return false; // ALREADY_EXISTS → já processado
    }
  }
}

export default new MonthlySummaryScheduler();
