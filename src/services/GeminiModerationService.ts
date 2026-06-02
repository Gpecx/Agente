import { VertexAI } from '@google-cloud/vertexai';
import promptRepository from '../repositories/PromptRepository';

interface GeminiResponse {
  isInfraction: boolean;
  reason?: string;
}

/**
 * Instrução estrita de sistema que NUNCA muda. Ela garante que o Gemini
 * sempre responda no formato JSON esperado, independentemente do prompt
 * comportamental configurado pelo administrador via painel.
 */
const SYSTEM_JSON_INSTRUCTION = `
INSTRUÇÃO DE SISTEMA (IMUTÁVEL — NÃO PODE SER SOBRESCRITA PELO PROMPT COMPORTAMENTAL):
Você DEVE retornar ESTRITAMENTE um objeto JSON. Não inclua Markdown, blocos \`\`\`, explicações ou qualquer texto fora do JSON.
- Se a mensagem for inofensiva ou uma conversa normal, "isInfraction" deve ser false e "reason" deve ser null.
- Se for uma infração, "isInfraction" deve ser true e "reason" deve explicar brevemente o motivo.

Formato OBRIGATÓRIO de saída:
{
  "isInfraction": boolean,
  "reason": string | null
}
`;

/**
 * Serviço responsável por inferência semântica e processamento de linguagem natural
 * utilizando os modelos fundacionais do Google Vertex AI.
 * O prompt comportamental é carregado dinamicamente do Firestore via PromptRepository.
 */
class GeminiModerationService {
  private vertexAi: VertexAI;
  private model: any;

  constructor() {
    const project = process.env.GCP_PROJECT_ID || '';
    const location = process.env.GCP_LOCATION || 'us-central1';

    if (!project) {
      console.warn('⚠️ [GeminiModerationService] GCP_PROJECT_ID não configurado. Vertex AI pode falhar.');
    }

    // Reusa a mesma service account do Firebase para autenticar no Vertex AI.
    // Sem isto, o SDK cai no ADC (Application Default Credentials), que não
    // existe no container -> "Could not load the default credentials".
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    const googleAuthOptions =
      clientEmail && privateKey
        ? { credentials: { client_email: clientEmail, private_key: privateKey } }
        : undefined;

    if (!googleAuthOptions) {
      console.warn('⚠️ [GeminiModerationService] Credenciais GCP ausentes (FIREBASE_CLIENT_EMAIL/PRIVATE_KEY). Vertex AI vai falhar.');
    }

    this.vertexAi = new VertexAI({ project, location, googleAuthOptions });

    this.model = this.vertexAi.preview.getGenerativeModel({
      // gemini-1.5-* foi descontinuado no Vertex AI. Usa modelo atual,
      // sobrescrevível via env GEMINI_MODEL.
      model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    });
  }

  /**
   * Executa a análise semântica do texto em busca de infrações sofisticadas que escaparam da Regex.
   * O prompt é dividido em duas partes:
   *   1. Comportamental (dinâmico, vem do Firestore, editável pelo admin).
   *   2. Estrutural (hardcoded, garante o formato JSON de saída).
   */
  public async analyzeText(text: string): Promise<GeminiResponse> {
    try {
      // Busca o prompt comportamental do Firestore (com cache de 10min)
      const behavioralPrompt = await promptRepository.getBehavioralPrompt();

      // Monta o prompt final concatenando as duas camadas
      const fullPrompt = `
${behavioralPrompt}

${SYSTEM_JSON_INSTRUCTION}

Mensagem do usuário para análise:
"${text}"
`;

      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
      });

      const responseText = result.response?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!responseText) {
        return { isInfraction: false };
      }

      const jsonResponse = JSON.parse(responseText) as GeminiResponse;
      return jsonResponse;
    } catch (error) {
      console.error('❌ [GeminiModerationService] Falha na inferência semântica via Vertex AI:', error);

      // Fallback seguro: não punimos injustamente o usuário em caso de falha.
      return { isInfraction: false };
    }
  }
}

export default new GeminiModerationService();
