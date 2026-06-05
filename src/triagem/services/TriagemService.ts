import { EvolutionWebhookPayload } from '../../interfaces/evolution.interface';
import evolutionApiService from '../../services/EvolutionApiService';
import moderationService from '../../services/ModerationService';
import triagemConfigRepository from '../repositories/TriagemConfigRepository';
import triagemCandidateRepository from '../repositories/TriagemCandidateRepository';
import geminiTriagemService from './GeminiTriagemService';
import {
  TriagemCandidate,
  TriagemRespostaAgente,
  TriagemStatus,
} from '../interfaces/triagem.interface';

/** Estados em que a conversa já terminou para o bot (não reabre a triagem). */
const TERMINAIS: TriagemStatus[] = ['aprovado', 'adicionado', 'reprovado', 'duvida'];

/** Teto de mensagens do candidato — evita loop/abuso e custo descontrolado. */
const MAX_TURNS = Number(process.env.TRIAGEM_MAX_TURNS || 20);

/** Como a entrada no grupo foi resolvida (para a notificação dos admins). */
type Entrega = 'adicionado' | 'convite' | 'manual' | 'sem_grupo';

/**
 * Interpreta a resposta do `addParticipant` da Evolution e diz se a adição foi
 * CONFIRMADA. A resposta varia entre versões (array, `{ updateParticipant }`,
 * etc.) e um 200 nem sempre significa que o membro entrou (privacidade pode
 * gerar convite em vez de adição). Por isso só confirmamos em sucesso explícito;
 * no resto, o chamador cai no plano B (link de convite) — é melhor mandar um
 * link redundante do que deixar um aprovado de fora.
 */
export function adicaoConfirmada(resp: any, jid: string): boolean {
  if (!resp) return false;

  const lista: any[] = Array.isArray(resp)
    ? resp
    : resp.updateParticipant || resp.participants || resp.update || [resp];
  if (!Array.isArray(lista) || lista.length === 0) return false;

  const numero = jid.split('@')[0];
  const entry =
    lista.find((e) => typeof e?.jid === 'string' && e.jid.includes(numero)) ?? lista[0];

  const status = String(entry?.status ?? entry?.code ?? '').toLowerCase();
  return status === '200' || status === 'success' || status === 'ok';
}

/**
 * Orquestra o funil de triagem por DM:
 *   1. carrega/cria o candidato e anexa a fala dele ao histórico;
 *   2. chama o agente (Gemini) para conduzir o diálogo;
 *   3. se "perguntar": responde no privado e aguarda;
 *   4. se "decidir": aplica o veredito — adiciona ao grupo (aprovado) ou recusa —
 *      e SEMPRE notifica a administração com a transcrição + veredito.
 *
 * O "portão" é: o candidato só entra quando o bot o adiciona após aprovação.
 */
class TriagemService {
  private get grupoJid(): string | undefined {
    return process.env.TRIAGEM_GRUPO_JID;
  }

  private get adminJid(): string | undefined {
    return process.env.TRIAGEM_ADMIN_JID || process.env.ADMIN_GROUP_JID;
  }

  /**
   * Recebe a DM crua do webhook e resolve o conteúdo para texto:
   * usa o texto da mensagem ou, se for áudio de voz (PTT), transcreve via Gemini.
   * Conteúdo não suportado (figurinha, imagem sem legenda...) gera uma orientação
   * cordial em vez de ser descartado silenciosamente.
   */
  public async handleIncomingDM(payload: EvolutionWebhookPayload): Promise<void> {
    const jid = payload.data?.key?.remoteJid;
    if (!jid) return;
    const instance = payload.instance;
    const pushName = payload.data?.pushName || '';

    let texto = moderationService.extractText(payload);

    if (!texto && payload.data?.message?.audioMessage) {
      texto = await this.transcreverAudio(instance, payload);
    }

    if (!texto) {
      await this.responder(
        instance,
        jid,
        'Consigo te atender por *texto* ou *áudio* 🙂 Pode mandar sua mensagem por aqui?'
      );
      return;
    }

    await this.handleDM(instance, jid, texto, pushName);
  }

  /** Baixa o áudio da DM na Evolution e devolve a transcrição (ou null). */
  private async transcreverAudio(
    instance: string,
    payload: EvolutionWebhookPayload
  ): Promise<string | null> {
    const audioMsg = payload.data?.message?.audioMessage;
    const media = await evolutionApiService.getBase64FromMediaMessage(
      instance,
      payload.data as Record<string, any>
    );
    const base64 = media?.base64;
    if (!base64) return null;

    const mime = String(media?.mimetype || audioMsg?.mimetype || 'audio/ogg')
      .split(';')[0]
      .trim();
    return geminiTriagemService.transcrever(base64, mime);
  }

  /**
   * Ponto de entrada para uma mensagem de DM de um candidato.
   * @param instance instância da Evolution (do payload)
   * @param jid JID do candidato (remoteJid da DM)
   * @param texto texto já extraído da mensagem
   * @param pushName nome de exibição do candidato (se houver)
   */
  public async handleDM(
    instance: string,
    jid: string,
    texto: string,
    pushName: string
  ): Promise<void> {
    let candidate = await triagemCandidateRepository.get(jid);
    if (!candidate) {
      candidate = await triagemCandidateRepository.create(jid, pushName);
    }

    // Já decidido: não reabre a triagem; dá um retorno cordial.
    if (TERMINAIS.includes(candidate.status)) {
      await this.responder(instance, jid, this.mensagemTerminal(candidate.status));
      return;
    }

    // Anexa a fala do candidato e protege contra loop/abuso.
    candidate.history.push({ role: 'user', text: texto });
    candidate.turns += 1;

    if (candidate.turns > MAX_TURNS) {
      await this.decidir(
        instance,
        jid,
        candidate,
        {
          action: 'decidir',
          mensagem:
            'Obrigado pelo papo! Já tenho o suficiente — vou encaminhar para um responsável finalizar. 🙏',
          veredito: 'duvida',
          justificativa: `Limite de ${MAX_TURNS} mensagens atingido sem conclusão automática.`,
          score: null,
        }
      );
      return;
    }

    const config = await triagemConfigRepository.get();
    const resposta = await geminiTriagemService.responder(candidate.history, config);

    // Registra a fala do bot no histórico (o que o candidato verá).
    candidate.history.push({ role: 'model', text: resposta.mensagem });

    if (resposta.action === 'perguntar') {
      await triagemCandidateRepository.save(jid, {
        history: candidate.history,
        turns: candidate.turns,
        status: 'em_andamento',
      });
      await this.responder(instance, jid, resposta.mensagem);
      return;
    }

    await this.decidir(instance, jid, candidate, resposta);
  }

  /** Aplica o veredito: persiste, responde o candidato, age e notifica admins. */
  private async decidir(
    instance: string,
    jid: string,
    candidate: TriagemCandidate,
    resposta: TriagemRespostaAgente
  ): Promise<void> {
    const veredito = resposta.veredito || 'duvida';
    let status: TriagemStatus = veredito;
    let entrega: Entrega | undefined;

    // Responde o candidato primeiro (mensagem final cordial).
    await this.responder(instance, jid, resposta.mensagem);

    // Aprovado → tenta entrar no grupo (se configurado).
    if (veredito === 'aprovado') {
      entrega = await this.efetivarEntrada(instance, jid);
      if (entrega === 'adicionado') status = 'adicionado';
      // 'convite'/'manual': mantém 'aprovado' até confirmarmos a entrada.
    }

    await triagemCandidateRepository.save(jid, {
      history: candidate.history,
      turns: candidate.turns,
      status,
      veredito,
      justificativa: resposta.justificativa || undefined,
      score: resposta.score ?? undefined,
    });

    await this.notificarAdmins(instance, candidate, resposta, status, entrega);
  }

  /**
   * Coloca o candidato aprovado no grupo. Tenta adicionar direto; se a adição
   * não for confirmada (ex.: privacidade do candidato), cai para o plano B:
   * envia o link de convite para ele entrar sozinho. Se nem isso der, sinaliza
   * para a administração adicionar manualmente.
   */
  private async efetivarEntrada(instance: string, jid: string): Promise<Entrega> {
    if (!this.grupoJid) {
      console.warn('⚠️ [Triagem] TRIAGEM_GRUPO_JID não definido — aprovado mas não adicionado.');
      return 'sem_grupo';
    }

    const resp = await evolutionApiService.addParticipant(instance, this.grupoJid, [jid]);
    if (adicaoConfirmada(resp, jid)) return 'adicionado';

    // Plano B: link de convite para o próprio candidato entrar.
    const convite = await evolutionApiService.fetchInviteCode(instance, this.grupoJid);
    if (convite) {
      await this.responder(instance, jid, `Pra garantir sua entrada, é só acessar este link 👉 ${convite}`);
      return 'convite';
    }

    console.warn('⚠️ [Triagem] Adição falhou e sem link de convite — requer adição manual.');
    return 'manual';
  }

  /** Envia a transcrição + veredito para a administração. */
  private async notificarAdmins(
    instance: string,
    candidate: TriagemCandidate,
    resposta: TriagemRespostaAgente,
    status: TriagemStatus,
    entrega?: Entrega
  ): Promise<void> {
    if (!this.adminJid) {
      console.warn('⚠️ [Triagem] Sem TRIAGEM_ADMIN_JID/ADMIN_GROUP_JID — veredito não enviado.');
      return;
    }

    const emoji = { aprovado: '✅', adicionado: '✅', reprovado: '⛔', duvida: '❓', em_andamento: '…' }[status];
    const numero = candidate.jid.split('@')[0];
    const transcricao = candidate.history
      .map((t) => `${t.role === 'user' ? '👤' : '🤖'} ${t.text}`)
      .join('\n');

    const texto =
      `${emoji} *Triagem concluída* — ${candidate.pushName || numero} (${numero})\n` +
      `Veredito: *${resposta.veredito || 'duvida'}*` +
      (resposta.score != null ? ` · Score: *${resposta.score}/100*` : '') +
      `\nStatus: *${status}*` +
      this.detalheEntrega(entrega) +
      `\nJustificativa: ${resposta.justificativa || '—'}\n\n` +
      `🗒️ *Transcrição:*\n${transcricao}`;

    await evolutionApiService.sendText(instance, this.adminJid, texto);
  }

  /** Linha extra na notificação descrevendo como a entrada foi (ou não) resolvida. */
  private detalheEntrega(entrega?: Entrega): string {
    switch (entrega) {
      case 'convite':
        return ' (⚠️ adição automática falhou — link de convite enviado ao candidato)';
      case 'manual':
        return ' (⚠️ adição falhou e sem link de convite — adicione manualmente)';
      case 'sem_grupo':
        return ' (⚠️ TRIAGEM_GRUPO_JID não configurado — adicione manualmente)';
      default:
        return '';
    }
  }

  private async responder(instance: string, jid: string, texto: string): Promise<void> {
    await evolutionApiService.sendText(instance, jid, texto);
  }

  private mensagemTerminal(status: TriagemStatus): string {
    if (status === 'adicionado' || status === 'aprovado') {
      return 'Você já foi aprovado(a) na triagem! Se ainda não entrou no grupo, um responsável vai te adicionar. 🙌';
    }
    if (status === 'reprovado') {
      return 'Sua triagem já foi concluída. Obrigado pelo interesse! 🙏';
    }
    return 'Sua triagem já está com um responsável para avaliação. Em breve retornamos. 🙏';
  }
}

export default new TriagemService();
