import { EvolutionWebhookPayload } from '../../interfaces/evolution.interface';
import evolutionApiService from '../../services/EvolutionApiService';
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

    // Responde o candidato primeiro (mensagem final cordial).
    await this.responder(instance, jid, resposta.mensagem);

    // Aprovado → adiciona ao grupo (se configurado).
    if (veredito === 'aprovado') {
      if (this.grupoJid) {
        try {
          await evolutionApiService.addParticipant(instance, this.grupoJid, [jid]);
          status = 'adicionado';
        } catch (error) {
          console.error('❌ [Triagem] Falha ao adicionar candidato ao grupo:', error);
          // Mantém 'aprovado'; admins veem que a adição falhou e fazem manual.
        }
      } else {
        console.warn('⚠️ [Triagem] TRIAGEM_GRUPO_JID não definido — aprovado mas não adicionado.');
      }
    }

    await triagemCandidateRepository.save(jid, {
      history: candidate.history,
      turns: candidate.turns,
      status,
      veredito,
      justificativa: resposta.justificativa || undefined,
      score: resposta.score ?? undefined,
    });

    await this.notificarAdmins(instance, candidate, resposta, status);
  }

  /** Envia a transcrição + veredito para a administração. */
  private async notificarAdmins(
    instance: string,
    candidate: TriagemCandidate,
    resposta: TriagemRespostaAgente,
    status: TriagemStatus
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
      (status === 'aprovado' ? ' (⚠️ adição ao grupo falhou — adicione manualmente)' : '') +
      `\nJustificativa: ${resposta.justificativa || '—'}\n\n` +
      `🗒️ *Transcrição:*\n${transcricao}`;

    await evolutionApiService.sendText(instance, this.adminJid, texto);
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
