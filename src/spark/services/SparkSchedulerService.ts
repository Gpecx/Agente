import cron, { ScheduledTask } from 'node-cron';
import { sparkConfig } from '../config/sparkConfig';
import sparkCommunityOrchestrator from './SparkCommunityOrchestrator';

class SparkSchedulerService {
  private challengeTask?: ScheduledTask;
  private answerTask?: ScheduledTask;
  private lifecycleTask?: ScheduledTask;

  start(): void {
    if (!sparkConfig.enabled || !sparkConfig.schedulerEnabled) {
      console.log('⏸️ [SparkScheduler] Desabilitado por configuracao.');
      return;
    }

    this.challengeTask = cron.schedule(sparkConfig.challengeTuesdayCron, () => {
      sparkCommunityOrchestrator
        .sendWeeklyChallenge()
        .catch((error) => console.error('❌ [SparkScheduler] Falha no desafio de terca:', error));
    });

    this.answerTask = cron.schedule(sparkConfig.challengeThursdayCron, () => {
      sparkCommunityOrchestrator
        .sendWeeklyAnswerAndBonus()
        .catch((error) => console.error('❌ [SparkScheduler] Falha na resposta de quinta:', error));
    });

    this.lifecycleTask = cron.schedule(sparkConfig.lifecycleCron, () => {
      sparkCommunityOrchestrator
        .runLifecycleChecks()
        .catch((error) => console.error('❌ [SparkScheduler] Falha no ciclo de vida:', error));
    });

    console.log('🧠 [SparkScheduler] Scheduler iniciado.');
  }

  stop(): void {
    this.challengeTask?.stop();
    this.answerTask?.stop();
    this.lifecycleTask?.stop();
  }
}

export default new SparkSchedulerService();
