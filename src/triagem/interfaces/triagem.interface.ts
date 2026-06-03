/** Papel de cada turno na conversa de triagem (compatível com o Vertex/Gemini). */
export type TriagemRole = 'user' | 'model';

/** Um turno da conversa entre candidato (user) e bot (model). */
export interface TriagemTurn {
  role: TriagemRole;
  text: string;
}

/** Status do candidato no funil de triagem. */
export type TriagemStatus =
  | 'em_andamento' // conversa em curso
  | 'aprovado' // decidido: passou (antes de adicionar)
  | 'adicionado' // passou e já foi adicionado ao grupo
  | 'reprovado' // decidido: não passou
  | 'duvida'; // bot não concluiu — encaminhado para decisão humana

/** Veredito final que o agente devolve ao decidir. */
export type TriagemVeredito = 'aprovado' | 'reprovado' | 'duvida';

/** Estado persistido de um candidato (doc em `triagem_candidatos/{jid}`). */
export interface TriagemCandidate {
  jid: string;
  pushName: string;
  status: TriagemStatus;
  history: TriagemTurn[];
  turns: number; // nº de mensagens do candidato já processadas
  veredito?: TriagemVeredito;
  justificativa?: string;
  score?: number;
}

/** Configuração editável da triagem (doc em `triagem_config/default`). */
export interface TriagemConfig {
  /** Critérios de aprovação (texto livre, vira parte do prompt do Gemini). */
  requisitos: string;
  /** Contexto do grupo/comunidade para o agente situar a conversa. */
  contexto: string;
  /** Nome amigável do grupo (usado na fala do bot). */
  nomeGrupo: string;
}

/** Resposta estruturada de um turno do agente. */
export interface TriagemRespostaAgente {
  action: 'perguntar' | 'decidir';
  mensagem: string;
  veredito: TriagemVeredito | null;
  justificativa: string | null;
  score: number | null;
}
