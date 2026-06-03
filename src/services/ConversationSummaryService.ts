import { VertexAI } from '@google-cloud/vertexai';
import messageArchiveRepository, { ArchivedMessage } from '../repositories/MessageArchiveRepository';
import evolutionApiService from './EvolutionApiService';

/** Resultado consolidado que o Gemini devolve na etapa de "reduce". */
interface ResumoConsolidado {
  assuntos: string[];
  duvidas: { quem: string; pergunta: string }[];
  tom: string;
}

/** Ranking de volume por participante. */
interface RankItem {
  jid: string;
  nome: string;
  total: number;
}

/** Quantas mensagens por bloco na etapa de "map" (controla contexto/custo). */
const CHUNK_SIZE = 120;
/** Teto de caracteres por mensagem no prompt (evita estourar com textão). */
const MAX_MSG_CHARS = 500;

/**
 * Gera o resumo mensal das conversas de um grupo:
 *   1. lê as mensagens arquivadas do mês (MessageArchiveRepository);
 *   2. calcula o ranking de "quem mandou mais" localmente (sem IA);
 *   3. resume o corpus em blocos via Gemini (map) e consolida (reduce);
 *   4. monta o texto e (opcionalmente) posta no grupo admin.
 *
 * Reusa a mesma autenticação Vertex do GeminiModerationService (a SA do Firebase).
 */
class ConversationSummaryService {
  private vertexAi: VertexAI;
  private model: any;

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
    this.model = this.vertexAi.preview.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      generationConfig: { temperature: 0.3 },
    });
  }

  /**
   * Gera o relatório (texto pronto) do mês informado para um grupo.
   * @param ano  ex.: 2026
   * @param mes  1–12 (mês civil)
   */
  public async gerarRelatorioDoMes(groupJid: string, ano: number, mes: number): Promise<string> {
    const inicio = new Date(ano, mes - 1, 1, 0, 0, 0, 0);
    const fim = new Date(ano, mes, 1, 0, 0, 0, 0); // 1º dia do mês seguinte

    const mensagens = await messageArchiveRepository.getMonth(groupJid, ano, mes);
    const periodo = `${this.fmtData(inicio)} a ${this.fmtData(new Date(fim.getTime() - 1))}`;

    if (mensagens.length === 0) {
      return (
        `📊 *Resumo Mensal* — ${this.nomeMes(mes)}/${ano}\n` +
        `Período: ${periodo}\n\n` +
        `Nenhuma mensagem de texto arquivada neste período.`
      );
    }

    const ranking = this.calcularRanking(mensagens);
    const consolidado = await this.resumirCorpus(mensagens);

    return this.montarRelatorio(mes, ano, periodo, mensagens.length, ranking, consolidado);
  }

  /**
   * Gera e posta o relatório no destino (default: ADMIN_GROUP_JID).
   * Usado pelo cron mensal e pelo endpoint manual.
   */
  public async gerarEEnviar(
    instance: string,
    groupJid: string,
    ano: number,
    mes: number,
    destinoJid?: string
  ): Promise<string> {
    const destino = destinoJid || process.env.ADMIN_GROUP_JID;
    const relatorio = await this.gerarRelatorioDoMes(groupJid, ano, mes);

    if (!destino) {
      console.warn('⚠️ [Summary] ADMIN_GROUP_JID não definido — relatório gerado mas não enviado.');
      return relatorio;
    }

    await evolutionApiService.sendText(instance, destino, relatorio);
    console.log(`📤 [Summary] Resumo de ${this.nomeMes(mes)}/${ano} enviado para ${destino}.`);
    return relatorio;
  }

  // ─── Etapa local: ranking de volume ──────────────────────────────────────

  private calcularRanking(mensagens: ArchivedMessage[]): RankItem[] {
    const mapa = new Map<string, { nome: string; total: number }>();

    for (const m of mensagens) {
      const atual = mapa.get(m.participantJid);
      const nome = m.pushName || atual?.nome || m.participantJid.split('@')[0];
      mapa.set(m.participantJid, { nome, total: (atual?.total || 0) + 1 });
    }

    return Array.from(mapa.entries())
      .map(([jid, v]) => ({ jid, nome: v.nome, total: v.total }))
      .sort((a, b) => b.total - a.total);
  }

  // ─── Etapa IA: map-reduce ────────────────────────────────────────────────

  /** Quebra o corpus em blocos, resume cada um (map) e consolida (reduce). */
  private async resumirCorpus(mensagens: ArchivedMessage[]): Promise<ResumoConsolidado> {
    const blocos: ArchivedMessage[][] = [];
    for (let i = 0; i < mensagens.length; i += CHUNK_SIZE) {
      blocos.push(mensagens.slice(i, i + CHUNK_SIZE));
    }

    const resumosParciais: string[] = [];
    for (const bloco of blocos) {
      const texto = bloco
        .map((m) => `${this.nomeAutor(m)}: ${this.truncar(m.text)}`)
        .join('\n');

      const prompt =
        `Você é um analista de comunidade. Resuma de forma objetiva, em português, os ASSUNTOS ` +
        `tratados neste trecho de conversa de um grupo de WhatsApp e liste PERGUNTAS/DÚVIDAS ` +
        `explícitas (com o nome de quem perguntou). Seja conciso.\n\nTrecho:\n${texto}`;

      resumosParciais.push(await this.gerar(prompt));
    }

    // Reduce: consolida os resumos parciais num JSON estruturado.
    const promptReduce =
      `Consolide os resumos parciais abaixo (de um mês de conversas de um grupo) em UM objeto JSON ` +
      `estrito, sem markdown, no formato:\n` +
      `{"assuntos": string[], "duvidas": [{"quem": string, "pergunta": string}], "tom": string}\n` +
      `- "assuntos": principais temas do mês (5 a 10 itens).\n` +
      `- "duvidas": perguntas que parecem ter ficado em aberto.\n` +
      `- "tom": uma frase sobre o clima geral das conversas.\n\n` +
      `Resumos parciais:\n${resumosParciais.join('\n---\n')}`;

    const respostaReduce = await this.gerar(promptReduce);
    return this.parseConsolidado(respostaReduce);
  }

  private async gerar(prompt: string): Promise<string> {
    try {
      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });
      return result.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch (error) {
      console.error('❌ [Summary] Falha na inferência Vertex AI:', error);
      return '';
    }
  }

  /** Parser defensivo do JSON consolidado (tolera cercas markdown e lixo). */
  private parseConsolidado(raw: string): ResumoConsolidado {
    const vazio: ResumoConsolidado = { assuntos: [], duvidas: [], tom: '' };
    if (!raw) return vazio;

    try {
      const limpo = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
      const inicio = limpo.indexOf('{');
      const fim = limpo.lastIndexOf('}');
      if (inicio === -1 || fim === -1) return vazio;

      const obj = JSON.parse(limpo.slice(inicio, fim + 1));
      return {
        assuntos: Array.isArray(obj.assuntos) ? obj.assuntos.map(String) : [],
        duvidas: Array.isArray(obj.duvidas)
          ? obj.duvidas
              .filter((d: any) => d && (d.pergunta || d.quem))
              .map((d: any) => ({ quem: String(d.quem || '—'), pergunta: String(d.pergunta || '') }))
          : [],
        tom: typeof obj.tom === 'string' ? obj.tom : '',
      };
    } catch (error) {
      console.error('❌ [Summary] Falha ao parsear JSON consolidado:', error);
      return vazio;
    }
  }

  // ─── Montagem do texto ───────────────────────────────────────────────────

  private montarRelatorio(
    mes: number,
    ano: number,
    periodo: string,
    totalMsgs: number,
    ranking: RankItem[],
    c: ResumoConsolidado
  ): string {
    const top = ranking.slice(0, 10);

    const linhasRank = top
      .map((r, i) => `${i + 1}. ${r.nome} — ${r.total} ${r.total === 1 ? 'mensagem' : 'mensagens'}`)
      .join('\n');

    const linhasAssuntos = c.assuntos.length
      ? c.assuntos.map((a) => `• ${a}`).join('\n')
      : '_Não identificados._';

    const linhasDuvidas = c.duvidas.length
      ? c.duvidas.map((d) => `• *${d.quem}:* ${d.pergunta}`).join('\n')
      : '_Nenhuma dúvida em aberto identificada._';

    return (
      `📊 *Resumo Mensal* — ${this.nomeMes(mes)}/${ano}\n` +
      `Período: ${periodo}\n` +
      `Mensagens de texto: *${totalMsgs}* · Participantes ativos: *${ranking.length}*\n\n` +
      `🏆 *Quem mais participou:*\n${linhasRank}\n\n` +
      `🗣️ *Principais assuntos:*\n${linhasAssuntos}\n\n` +
      `❓ *Dúvidas em aberto:*\n${linhasDuvidas}\n\n` +
      `🌡️ *Tom geral:* ${c.tom || '_n/d_'}\n\n` +
      `_Observação: o resumo considera apenas mensagens de texto; áudios, imagens e figurinhas não são analisados._`
    );
  }

  // ─── Utilitários ─────────────────────────────────────────────────────────

  private nomeAutor(m: ArchivedMessage): string {
    return m.pushName || m.participantJid.split('@')[0];
  }

  private truncar(texto: string): string {
    return texto.length > MAX_MSG_CHARS ? `${texto.slice(0, MAX_MSG_CHARS)}…` : texto;
  }

  private fmtData(d: Date): string {
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  private nomeMes(mes: number): string {
    const nomes = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
    ];
    return nomes[mes - 1] || String(mes);
  }
}

export default new ConversationSummaryService();
