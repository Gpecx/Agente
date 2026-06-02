import dotenv from 'dotenv';

dotenv.config();

/**
 * Configuração centralizada do módulo de Webinars.
 *
 * Tudo é externalizado via env (spec §7: "Nada hardcoded"). Listas aceitam
 * valores separados por vírgula. Valores numéricos têm defaults seguros.
 */

function parseList(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return value
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

function parseNumber(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const webinarConfig = {
  /** Emoji de reação usado como opt-in para lembretes (DM). */
  optInEmoji: process.env.WEBINAR_OPTIN_EMOJI || '🔥',

  /** Palavras proibidas (case-insensitive). Configurável — não hardcode. */
  palavroes: parseList(process.env.WEBINAR_PALAVROES, ['palavrao1', 'palavrao2']),

  /** Allowlist de domínios permitidos em links (o resto é considerado não autorizado). */
  dominiosPermitidos: parseList(process.env.WEBINAR_DOMINIOS_PERMITIDOS, [
    'youtube.com',
    'youtu.be',
    'zoom.us',
  ]),

  /** JID que recebe o relatório CSV semanal (pessoa ou grupo). */
  adminReportJid: process.env.ADMIN_REPORT_JID || process.env.ADMIN_GROUP_JID || '',

  /** Link do e-book entregue no pós-evento (/ebook). */
  ebookUrl: process.env.WEBINAR_EBOOK_URL || '',

  /** Link genérico de documentação usado em respostas de FAQ. */
  docsUrl: process.env.WEBINAR_DOCS_URL || '',

  /** Nome da instância da Evolution API (necessário p/ ações disparadas por cron). */
  evolutionInstance: process.env.EVOLUTION_INSTANCE || '',

  /** JID do grupo onde o bot posta teasers/enquetes proativamente (cron). */
  webinarGroupJid: process.env.WEBINAR_GROUP_JID || '',

  /** Liga/desliga o scheduler (cron). Default ligado. */
  schedulerEnabled: (process.env.WEBINAR_SCHEDULER_ENABLED ?? 'true') !== 'false',

  /** % mínimo de presença para liberar certificado (0.0 a 1.0). */
  presencaMinima: parseNumber(process.env.WEBINAR_PRESENCA_MINIMA, 0.8),

  // --- Janelas dos estados (em horas, relativas a data_hora) ---
  /** Início do AQUECIMENTO: D-7 (168h antes). */
  aquecimentoHorasAntes: parseNumber(process.env.WEBINAR_AQUECIMENTO_H, 168),
  /** Início do DIA D: 1h antes. */
  diaDHorasAntes: parseNumber(process.env.WEBINAR_DIAD_H, 1),
  /** Fim da COLETA: D+2 (48h depois). */
  coletaHorasDepois: parseNumber(process.env.WEBINAR_COLETA_H, 48),

  // --- Anti-ban (envios em lote) ---
  /** Delay mínimo entre DMs em lote (ms). */
  dmDelayMinMs: parseNumber(process.env.WEBINAR_DM_DELAY_MIN_MS, 1200),
  /** Jitter máximo adicional aleatório (ms). */
  dmDelayJitterMs: parseNumber(process.env.WEBINAR_DM_DELAY_JITTER_MS, 2500),

  /** Duração do "mute" simulado (ms). Default 10 min. */
  muteDurationMs: parseNumber(process.env.WEBINAR_MUTE_MS, 10 * 60 * 1000),

  /** Janela "membro recente" para receber lembrete de DIA D (dias). */
  membroRecenteDias: parseNumber(process.env.WEBINAR_MEMBRO_RECENTE_DIAS, 30),
};

export type WebinarConfig = typeof webinarConfig;
