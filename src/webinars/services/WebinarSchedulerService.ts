import cron, { ScheduledTask } from 'node-cron';
import { Webinar } from '../interfaces/webinar.interface';
import webinarRepository from '../repositories/WebinarRepository';
import cronExecRepository from '../repositories/CronExecRepository';
import campaign from './WebinarCampaignService';
import reporting from './ReportingService';
import { webinarConfig } from '../config/webinarConfig';

const MIN = 60 * 1000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

/** Definição de um gatilho relativo a `dataHora`. */
interface GatilhoDef {
  gatilho: string;
  /** Offset em ms aplicado a dataHora (negativo = antes). */
  offsetMs: number;
  /** Janela (ms) após o alvo em que o gatilho ainda pode disparar (grace). */
  janelaMs: number;
  /** Só dispara se o webinar estiver finalizado. */
  exigeFinished?: boolean;
  acao: (w: Webinar) => Promise<unknown>;
}

/**
 * Scheduler do módulo (spec §3 / §2.10). Estratégia: um TICK por minuto avalia
 * todos os webinars ativos e dispara os gatilhos cuja janela está aberta e que
 * ainda não foram executados (idempotência via CronExecRepository).
 *
 * Vantagem sobre agendar crons exatos por webinar: sobrevive a criação/edição
 * de webinars em runtime sem reprogramar jobs. Limitação: se o processo ficar
 * fora do ar durante toda a janela de grace de um gatilho, ele é pulado
 * (best-effort, documentado no README).
 *
 * O relatório de "Sexta 18h" usa um cron horário dedicado.
 */
class WebinarSchedulerService {
  private tickTask?: ScheduledTask;
  private reportTask?: ScheduledTask;

  private gatilhos: GatilhoDef[] = [
    { gatilho: 'teaser:D-7', offsetMs: -7 * DIA, janelaMs: 10 * MIN, acao: (w) => campaign.postarTeaser(w, 'D-7') },
    { gatilho: 'teaser:D-3', offsetMs: -3 * DIA, janelaMs: 10 * MIN, acao: (w) => campaign.postarTeaser(w, 'D-3') },
    { gatilho: 'teaser:D-1', offsetMs: -1 * DIA, janelaMs: 10 * MIN, acao: (w) => campaign.postarTeaser(w, 'D-1') },
    { gatilho: 'lembrete:1h', offsetMs: -1 * HORA, janelaMs: 10 * MIN, acao: (w) => campaign.enviarLembrete(w, '1h') },
    { gatilho: 'lembrete:10min', offsetMs: -10 * MIN, janelaMs: 5 * MIN, acao: (w) => campaign.enviarLembrete(w, '10min') },
    { gatilho: 'coleta:+30min', offsetMs: +30 * MIN, janelaMs: 30 * MIN, exigeFinished: true, acao: (w) => campaign.abrirColeta(w) },
    { gatilho: 'coleta:D+1', offsetMs: +1 * DIA, janelaMs: 2 * HORA, exigeFinished: true, acao: (w) => campaign.lembrarFormIncompleto(w) },
  ];

  /** Inicializa os jobs de cron. Chamar uma vez no boot. */
  start(): void {
    if (!webinarConfig.schedulerEnabled) {
      console.log('⏸️ [WebinarScheduler] Desabilitado por configuração (WEBINAR_SCHEDULER_ENABLED=false).');
      return;
    }

    // Tick a cada minuto: avalia gatilhos relativos a data_hora.
    this.tickTask = cron.schedule('* * * * *', () => {
      this.tick().catch((e) => console.error('❌ [WebinarScheduler] Erro no tick:', e));
    });

    // Relatório semanal: toda sexta às 18h.
    this.reportTask = cron.schedule('0 18 * * 5', () => {
      console.log('📅 [WebinarScheduler] Disparando relatório semanal (Sexta 18h).');
      reporting
        .enviarRelatorioSemanal(webinarConfig.evolutionInstance)
        .catch((e) => console.error('❌ [WebinarScheduler] Erro no relatório semanal:', e));
    });

    console.log('🕒 [WebinarScheduler] Scheduler iniciado (tick 1/min + relatório sexta 18h).');
  }

  stop(): void {
    this.tickTask?.stop();
    this.reportTask?.stop();
  }

  /** Avalia todos os webinars e dispara os gatilhos com janela aberta. */
  async tick(agora: Date = new Date()): Promise<void> {
    const webinars = await webinarRepository.listAtivos();
    const t = agora.getTime();

    for (const w of webinars) {
      const inicio = w.dataHora.getTime();

      for (const g of this.gatilhos) {
        const alvo = inicio + g.offsetMs;
        const dentroJanela = t >= alvo && t < alvo + g.janelaMs;
        if (!dentroJanela) continue;
        if (g.exigeFinished && w.status !== 'finished') continue;

        // Idempotência: só executa se for inédito (transação atômica).
        const inedito = await cronExecRepository.marcarSeInedito(w.id, g.gatilho);
        if (!inedito) continue;

        console.log(`🔔 [WebinarScheduler] Disparando "${g.gatilho}" para webinar ${w.id}.`);
        try {
          await g.acao(w);
        } catch (error) {
          console.error(`❌ [WebinarScheduler] Falha na ação "${g.gatilho}" (${w.id}):`, error);
        }
      }
    }
  }
}

export default new WebinarSchedulerService();
