export interface EvolutionWebhookPayload {
  event: string;
  instance: string;
  data: EvolutionWebhookData;
  destination: string;
  date_time: string;
  sender: string;
  server_url: string;
  apikey: string;
}

export interface EvolutionWebhookData {
  key?: EvolutionMessageKey;
  pushName?: string;
  message?: any; // To be refined as the implementation grows
  messageType?: string;
  messageTimestamp?: number;
  owner?: string;
  source?: string;
  status?: string;

  // --- Campos do evento group-participants.update ---
  id?: string;               // ID do grupo (alternativa ao key.remoteJid em eventos de participante)
  groupJid?: string;          // JID do grupo (outra variação da Evolution dependendo da versão)
  action?: string;            // 'add' | 'remove' | 'promote' | 'demote'
  participants?: string[];    // Array de JIDs dos participantes afetados pela ação
}

export interface EvolutionMessageKey {
  remoteJid: string; // The chat ID (group or individual)
  fromMe: boolean;   // True if the message was sent by the connected instance
  id: string;
  participant?: string; // The ID of the actual sender (present in groups)
}
