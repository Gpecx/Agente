import dotenv from 'dotenv';

// Garante que as variáveis de ambiente sejam carregadas caso a classe seja inicializada precocemente
dotenv.config();

interface QueuedRequest {
  endpoint: string;
  method: string;
  body?: Record<string, any>;
  resolve: (value: any) => void;
}

/**
 * Service responsável exclusivamente por realizar requisições HTTP para a Evolution API.
 * Aplica o princípio de Single Responsibility e possui uma Fila de Saída (Outbound Queue) embutida.
 */
class EvolutionApiService {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  
  // Controle de Fila Anti-Timeout
  private queue: QueuedRequest[] = [];
  private isProcessingQueue = false;
  private readonly QUEUE_DELAY_MS = 300; // 300ms de "cooldown" entre disparos REST

  constructor() {
    this.baseUrl = process.env.EVOLUTION_API_URL || '';
    this.apiKey = process.env.EVOLUTION_API_KEY || '';

    if (!this.baseUrl || !this.apiKey) {
      console.warn('⚠️ EVOLUTION_API_URL ou EVOLUTION_API_KEY não definidos. O serviço de API pode não funcionar.');
    }
  }

  /**
   * Enfileira requisições para proteger a Evolution API contra gargalos de I/O.
   */
  private request<T>(endpoint: string, method: string, body?: Record<string, any>): Promise<T | void> {
    return new Promise((resolve) => {
      this.queue.push({ endpoint, method, body, resolve });
      this.processQueue();
    });
  }

  /**
   * Processador de fila que libera as chamadas em background de forma controlada.
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.queue.length === 0) return;
    
    this.isProcessingQueue = true;

    while (this.queue.length > 0) {
      const currentRequest = this.queue.shift();
      if (currentRequest) {
        // Dispara e absorve exceções isoladamente para a fila não parar
        await this.executeRequest(currentRequest.endpoint, currentRequest.method, currentRequest.body)
          .then(currentRequest.resolve)
          .catch(() => currentRequest.resolve(undefined));
      }
      
      // Delay (cooldown) fixo para cadenciar o tráfego de saída
      await new Promise(res => setTimeout(res, this.QUEUE_DELAY_MS));
    }

    this.isProcessingQueue = false;
  }

  /**
   * Método utilitário atômico que realiza o disparo HTTP real.
   */
  private async executeRequest<T>(endpoint: string, method: string, body?: Record<string, any>): Promise<T | void> {
    // Garante que a URL base termine sem barra e o endpoint comece com barra
    const url = `${this.baseUrl.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`;

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          apikey: this.apiKey, // Injeção automática da apiKey
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        // Captura a mensagem de erro que a Evolution API retorna
        const errorData = await response.text();
        console.error(`❌ Erro na Evolution API [${method} ${endpoint}]: Status ${response.status}`, errorData);
        return; // Retorno antecipado para não disparar exceção
      }

      // Evita falhar se a resposta não for um JSON válido (ex: 204 No Content)
      const textResponse = await response.text();
      return textResponse ? (JSON.parse(textResponse) as T) : undefined;
    } catch (error) {
      console.error(`❌ Falha grave ao tentar contatar Evolution API [${method} ${endpoint}]:`, error);
      // O erro é suprimido (não damos throw) para não quebrar a execução do webhook
    }
  }

  /**
   * Deleta uma mensagem específica na instância da Evolution.
   */
  public async deleteMessage(instance: string, remoteJid: string, messageId: string, fromMe: boolean, participant?: string): Promise<void> {
    const endpoint = `/chat/deleteMessageForEveryone/${instance}`;
    const body: Record<string, any> = {
      remoteJid,
      id: messageId,
      fromMe,
    };

    // Para deletar mensagens de outras pessoas em grupos, a Evolution exige o 'participant'.
    if (participant) {
      body.participant = participant;
    }

    console.log(`🗑️ Deletando mensagem ${messageId} na conversa ${remoteJid} (Instância: ${instance})`);
    await this.request(endpoint, 'DELETE', body);
  }

  /**
   * Envia uma mensagem de texto mencionando um participante (muito útil em punições de grupos).
   */
  public async sendTextWithMention(instance: string, remoteJid: string, text: string, mentionedJid: string): Promise<void> {
    const endpoint = `/message/sendText/${instance}`;
    const body = {
      number: remoteJid,
      text,
      mentioned: [mentionedJid], // Array de JIDs a serem mencionados
    };

    console.log(`💬 Enviando aviso/mensagem com menção para ${mentionedJid} no grupo ${remoteJid}`);
    await this.request(endpoint, 'POST', body);
  }

  /**
   * Envia uma mensagem de texto simples (sem menção).
   * Usada em DMs (lembretes, boas-vindas, entrega de e-book/certificado).
   */
  public async sendText(instance: string, number: string, text: string): Promise<void> {
    const endpoint = `/message/sendText/${instance}`;
    const body = { number, text };
    await this.request(endpoint, 'POST', body);
  }

  /**
   * Envia uma reação (emoji) a uma mensagem específica.
   * (Endpoint de reação da Evolution API / Baileys.)
   */
  public async sendReaction(
    instance: string,
    remoteJid: string,
    messageId: string,
    fromMe: boolean,
    emoji: string
  ): Promise<void> {
    const endpoint = `/message/sendReaction/${instance}`;
    const body = {
      key: { remoteJid, fromMe, id: messageId },
      reaction: emoji,
    };
    await this.request(endpoint, 'POST', body);
  }

  /**
   * Envia uma enquete (poll). Rastreamento de votos é best-effort (spec §2.5).
   */
  public async sendPoll(
    instance: string,
    number: string,
    name: string,
    values: string[],
    selectableCount = 1
  ): Promise<void> {
    const endpoint = `/message/sendPoll/${instance}`;
    const body = { number, name, selectableCount, values };
    console.log(`📊 Enviando enquete "${name}" para ${number}`);
    await this.request(endpoint, 'POST', body);
  }

  /**
   * Atualiza a descrição (subject/description) do grupo.
   * Usado por `atualizarInfoFixada()` como substituto do "pin" (spec §2.6).
   */
  public async updateGroupDescription(
    instance: string,
    groupJid: string,
    description: string
  ): Promise<void> {
    const endpoint = `/group/updateGroupDescription/${instance}`;
    const body = { groupJid, description };
    console.log(`📌 Atualizando descrição do grupo ${groupJid}`);
    await this.request(endpoint, 'POST', body);
  }

  /**
   * Envia um documento/arquivo via URL ou base64 (usado para entregar o certificado PDF).
   */
  public async sendMedia(
    instance: string,
    number: string,
    options: { mediatype: 'document' | 'image'; media: string; fileName?: string; caption?: string }
  ): Promise<void> {
    const endpoint = `/message/sendMedia/${instance}`;
    const body = {
      number,
      mediatype: options.mediatype,
      media: options.media,
      fileName: options.fileName,
      caption: options.caption,
    };
    console.log(`📎 Enviando mídia (${options.mediatype}) para ${number}`);
    await this.request(endpoint, 'POST', body);
  }

  /**
   * Remove participantes (kick) de um grupo específico.
   */
  public async removeParticipant(instance: string, remoteJid: string, participantJids: string[]): Promise<void> {
    const endpoint = `/group/updateParticipant/${instance}`;
    const body = {
      groupJid: remoteJid,
      action: 'remove', // Ação específica de remoção na Evolution API
      participants: participantJids,
    };

    console.log(`👢 Removendo ${participantJids.length} participante(s) do grupo ${remoteJid}`);
    await this.request(endpoint, 'POST', body);
  }
}

// Exporta o serviço em padrão Singleton
export default new EvolutionApiService();
