import * as admin from 'firebase-admin';

/**
 * Tipos de domínio do módulo de Webinars.
 *
 * IMPORTANTE: este projeto usa Firestore (schema-less). As "6 tabelas" da spec
 * original (PostgreSQL) foram modeladas como coleções Firestore. Os tipos abaixo
 * descrevem o formato lógico dos documentos.
 */

/** Timestamp pode chegar como Timestamp (lido), FieldValue (gravado) ou Date. */
export type FirestoreTimestamp =
  | admin.firestore.Timestamp
  | admin.firestore.FieldValue
  | Date;

/** Estados da máquina de estados do bot (calculados, nunca persistidos como enum global). */
export enum EstadoWebinar {
  IDLE = 'IDLE',
  AQUECIMENTO = 'AQUECIMENTO',
  DIA_D = 'DIA_D',
  COLETA = 'COLETA',
}

/** Status do webinar (equivalente ao ENUM da spec). */
export type WebinarStatus = 'scheduled' | 'live' | 'finished';

/** Coleção: `webinars` */
export interface Webinar {
  id: string; // doc id (string p/ compatibilidade Firestore; representa o BIGINT da spec)
  tema: string;
  /** Data/hora de início. Em memória trabalhamos sempre com Date. */
  dataHora: Date;
  palestrante: string;
  linkSala: string;
  status: WebinarStatus;
}

/** Coleção: `webinar_usuarios` — PK = JID do WhatsApp. */
export interface WebinarUsuario {
  id: string; // JID completo (ex.: 5511999999999@s.whatsapp.net)
  username?: string; // pushName
  joinedAt?: FirestoreTimestamp;
  notificacao: boolean; // deu opt-in (reagiu com o emoji de lembrete)
  ultimoWebinar?: string | null; // FK -> webinars.id
  /** Janela de "mute" simulado: epoch ms até quando as mensagens dele são apagadas. */
  silenciadoAte?: number | null;
}

/** Coleção: `perguntas` */
export interface Pergunta {
  id?: string;
  usuarioId: string; // FK JID
  webinarId: string; // FK
  texto: string;
  respondida: boolean;
  createdAt?: FirestoreTimestamp;
}

/** Coleção: `presencas` */
export interface Presenca {
  id?: string;
  usuarioId: string; // FK JID
  webinarId: string; // FK
  checkIn?: FirestoreTimestamp; // momento do /presente
  percentual: number; // 0.0 a 1.0
}

/** Coleção: `formularios` */
export interface Formulario {
  id?: string;
  usuarioId: string; // FK JID
  webinarId: string; // FK
  nps: number; // 0 a 10
  completo: boolean;
  createdAt?: FirestoreTimestamp;
}

/** Coleção: `logs_moderacao` */
export type AcaoModeracao = 'delete' | 'mute' | 'warn';

export interface LogModeracao {
  id?: string;
  usuarioId: string; // FK JID
  acao: AcaoModeracao;
  motivo: string;
  createdAt?: FirestoreTimestamp;
}

/**
 * Coleção: `cron_exec` — controle de idempotência dos gatilhos de cron.
 * Doc id = `${webinarId}:${gatilho}` garante que um job não execute 2x.
 */
export interface CronExec {
  webinarId: string;
  gatilho: string;
  executadoEm: FirestoreTimestamp;
}
