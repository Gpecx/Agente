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
  public async deleteMessage(instance: string, remoteJid: string, messageId: string, fromMe: boolean): Promise<void> {
    const endpoint = `/chat/deleteMessage/${instance}`;
    const body = {
      number: remoteJid,
      messageId,
      fromMe,
    };

    console.log(`🗑️ Deletando mensagem ${messageId} na conversa ${remoteJid} (Instância: ${instance})`);
    await this.request(endpoint, 'POST', body);
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
