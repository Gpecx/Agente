import dotenv from 'dotenv';

dotenv.config();

function parseNumber(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseList(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export const sparkConfig = {
  enabled: process.env.SPARK_ENABLED === 'true',
  evolutionInstance: process.env.EVOLUTION_INSTANCE || '',
  groupJid: process.env.SPARK_GROUP_JID || '',
  adminJids: parseList(process.env.SPARK_ADMIN_JIDS),
  schedulerEnabled: (process.env.SPARK_SCHEDULER_ENABLED ?? 'true') !== 'false',
  trialDays: parseNumber(process.env.SPARK_TRIAL_DAYS, 14),
  inactivityDays: parseNumber(process.env.SPARK_INACTIVITY_DAYS, 3),
  expiryLeadDays: parseNumber(process.env.SPARK_EXPIRY_LEAD_DAYS, 4),
  challengeTuesdayCron: process.env.SPARK_CHALLENGE_TUESDAY_CRON || '0 10 * * 2',
  challengeThursdayCron: process.env.SPARK_CHALLENGE_THURSDAY_CRON || '0 10 * * 4',
  lifecycleCron: process.env.SPARK_LIFECYCLE_CRON || '0 11 * * *',
  defaultKey: process.env.SPARK_DEFAULT_KEY || 'SPARK-TRIAL',
  activationUrl: process.env.SPARK_ACTIVATION_URL || '',
  appUrl: process.env.SPARK_APP_URL || '',
  plansUrl: process.env.SPARK_PLANS_URL || '',
  plansText:
    process.env.SPARK_PLANS_TEXT ||
    'Plano Start, Pro e Scale. Responda se quiser ajuda para escolher o melhor.',
  helpText:
    process.env.SPARK_HELP_TEXT ||
    'Vou te encaminhar para um especialista humano. Me diga em uma frase o que você precisa.',
  mainMenuText:
    process.env.SPARK_MAIN_MENU_TEXT ||
    [
      'Menu principal Spark:',
      '1. Digite *planos* para ver valores e link',
      '2. Digite *chave* para receber sua ativacao novamente',
      '3. Digite *ajuda* para falar com um especialista',
    ].join('\n'),
  challengeText:
    process.env.SPARK_CHALLENGE_TEXT ||
    'Desafio da semana: responda com uma dica tecnica ou um caso real que te ensinou algo esta semana.',
  challengeAnswerText:
    process.env.SPARK_CHALLENGE_ANSWER_TEXT ||
    'Resposta do desafio: documente o aprendizado, valide em ambiente controlado e compartilhe o resultado com o time.',
  challengeBonusText:
    process.env.SPARK_CHALLENGE_BONUS_TEXT ||
    'Bonus Spark: como voce participou do desafio, aqui vai um material extra para acelerar sua aplicacao pratica.',
  technicalQuestionText:
    process.env.SPARK_TECHNICAL_QUESTION_TEXT ||
    'Faz 3 dias que voce nao interage por aqui. Qual ponto tecnico esta te travando hoje?',
  appCtaText:
    process.env.SPARK_APP_CTA_TEXT ||
    'Boa. O melhor proximo passo e testar isso dentro do app e comparar com seu caso real.',
  upgradeText:
    process.env.SPARK_UPGRADE_TEXT ||
    'Voce ja esta usando bem o Spark. Faz sentido liberar recursos avancados antes do trial acabar.',
  lowUsageDiagnosticText:
    process.env.SPARK_LOW_USAGE_DIAGNOSTIC_TEXT ||
    'Percebi pouco uso ate aqui. O que mais te travou: tempo, clareza de como usar, ou alguma limitacao tecnica?',
  extensionText:
    process.env.SPARK_EXTENSION_TEXT ||
    'Obrigado pelo contexto. Posso te orientar no melhor proximo passo e avaliar uma extensao do acesso de teste.',
  feedbackText:
    process.env.SPARK_FEEDBACK_TEXT ||
    'Valeu por responder. Seu feedback ajuda a ajustar a experiencia. Se quiser, eu tambem posso te conectar com um especialista.',
};

export type SparkConfig = typeof sparkConfig;
