import { VertexAI } from '@google-cloud/vertexai';
import {
  TriagemConfig,
  TriagemRespostaAgente,
  TriagemTurn,
  TriagemVeredito,
} from '../interfaces/triagem.interface';

/**
 * Agente conversacional de triagem. Conduz um diálogo natural com o candidato
 * (multi-turno) e, quando tem informação suficiente, devolve um veredito.
 *
 * Reusa a autenticação Vertex da SA do Firebase (mesmo padrão do
 * GeminiModerationService). A saída é SEMPRE um JSON estruturado.
 */
class GeminiTriagemService {
  private vertexAi: VertexAI;

  constructor() {
    const project = process.env.GCP_PROJECT_ID || '';
    const location = process.env.GCP_LOCATION || 'us-central1';
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    const googleAuthOptions =
      clientEmail && privateKey
        ? { credentials: { client_email: clientEmail, private_key: privateKey } }
        : undefined;

    this.vertexAi = new VertexAI({ project, location, googleAuthOptions });
  }

  /** Monta a instrução de sistema a partir da config (editável em runtime). */
  private systemInstruction(config: TriagemConfig): string {
    return `
Você é o assistente de triagem de entrada de "${config.nomeGrupo}".

CONTEXTO DO GRUPO:
${config.contexto}

REQUISITOS DE APROVAÇÃO (avalie o candidato contra isto):
${config.requisitos}

COMO CONDUZIR:
- Converse em português, de forma cordial, humana e objetiva.
- Faça no máximo 1–2 perguntas por vez; faça perguntas de acompanhamento se uma resposta ficar vaga.
- Não revele os critérios internos nem que está "pontuando"; aja como um anfitrião simpático fazendo uma pré-entrevista.
- Quando tiver informação suficiente para decidir com segurança, finalize (não enrole além do necessário).
- Se o candidato for claramente spam/divulgação ou claramente fora do perfil, pode decidir cedo.

FORMATO DE SAÍDA (responda SEMPRE com um ÚNICO objeto JSON, sem markdown):
{
  "action": "perguntar" | "decidir",
  "mensagem": "texto que será enviado ao candidato no WhatsApp",
  "veredito": "aprovado" | "reprovado" | "duvida" | null,
  "justificativa": "explicação curta para a administração" | null,
  "score": número de 0 a 100 indicando o quão bem bate com o perfil | null
}
Regras do formato:
- action "perguntar": veredito/justificativa/score = null; "mensagem" é a próxima pergunta.
- action "decidir": preencha veredito, justificativa e score; "mensagem" é a resposta final e cordial ao candidato (sem expor a justificativa interna).
- Use veredito "duvida" quando faltar base para um sim/não claro (encaminha para um humano).
`.trim();
  }

  private get model() {
    return this.vertexAi.preview.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      generationConfig: { temperature: 0.5, responseMimeType: 'application/json' },
    });
  }

  /**
   * Processa um turno: recebe o histórico completo (terminando na fala do
   * candidato) e devolve a resposta estruturada do agente.
   */
  public async responder(history: TriagemTurn[], config: TriagemConfig): Promise<TriagemRespostaAgente> {
    try {
      const contents = history.map((t) => ({ role: t.role, parts: [{ text: t.text }] }));

      const result = await this.model.generateContent({
        systemInstruction: { role: 'system', parts: [{ text: this.systemInstruction(config) }] },
        contents,
      } as any);

      const raw = result.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return this.parse(raw);
    } catch (error) {
      console.error('❌ [GeminiTriagem] Falha na inferência:', error);
      // Fallback seguro: não decide sozinho em caso de erro — encaminha ao humano.
      return {
        action: 'decidir',
        mensagem:
          'Obrigado pelas respostas! Vou encaminhar seu contato para um responsável dar sequência. 🙏',
        veredito: 'duvida',
        justificativa: 'Falha técnica na avaliação automática — requer revisão humana.',
        score: null,
      };
    }
  }

  /** Parser defensivo do JSON (tolera cercas markdown e ruído). */
  private parse(raw: string): TriagemRespostaAgente {
    const fallback: TriagemRespostaAgente = {
      action: 'perguntar',
      mensagem: 'Pode me contar um pouco mais sobre você?',
      veredito: null,
      justificativa: null,
      score: null,
    };
    if (!raw) return fallback;

    try {
      const limpo = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
      const ini = limpo.indexOf('{');
      const fim = limpo.lastIndexOf('}');
      if (ini === -1 || fim === -1) return fallback;

      const obj = JSON.parse(limpo.slice(ini, fim + 1));
      const action = obj.action === 'decidir' ? 'decidir' : 'perguntar';
      const veredito = this.normalizarVeredito(obj.veredito);

      return {
        action,
        mensagem: typeof obj.mensagem === 'string' && obj.mensagem.trim() ? obj.mensagem.trim() : fallback.mensagem,
        veredito: action === 'decidir' ? veredito ?? 'duvida' : null,
        justificativa: typeof obj.justificativa === 'string' ? obj.justificativa : null,
        score: typeof obj.score === 'number' ? obj.score : null,
      };
    } catch (error) {
      console.error('❌ [GeminiTriagem] Falha ao parsear JSON do agente:', error);
      return fallback;
    }
  }

  private normalizarVeredito(v: any): TriagemVeredito | null {
    return v === 'aprovado' || v === 'reprovado' || v === 'duvida' ? v : null;
  }
}

export default new GeminiTriagemService();
