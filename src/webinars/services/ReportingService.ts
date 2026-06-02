import evolutionApiService from '../../services/EvolutionApiService';
import webinarRepository from '../repositories/WebinarRepository';
import presencaRepository from '../repositories/PresencaRepository';
import formularioRepository from '../repositories/FormularioRepository';
import moderacaoLogRepository from '../repositories/ModeracaoLogRepository';
import webinarUserRepository from '../repositories/WebinarUserRepository';
import { webinarConfig } from '../config/webinarConfig';

/**
 * Geração e envio do relatório semanal (spec §3, "Sexta 18h").
 *
 * Consolida usuários, interações (logs de moderação), NPS e presença, gera um
 * CSV e envia ao admin (ADMIN_REPORT_JID) como documento + resumo em texto.
 *
 * "Cliques" não são rastreados de forma confiável no WhatsApp/Evolution — são
 * reportados como best-effort (coluna deixada como n/d) e isso é logado.
 */
class ReportingService {
  private toCsvLine(campos: (string | number)[]): string {
    return campos
      .map((c) => {
        const s = String(c ?? '');
        return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      })
      .join(';');
  }

  /** Gera o CSV consolidado de todos os webinars ativos. */
  async gerarCsv(): Promise<{ csv: string; resumo: string }> {
    const webinars = await webinarRepository.listAtivos();

    const linhas: string[] = [];
    linhas.push(
      this.toCsvLine([
        'webinar_id',
        'tema',
        'data_hora',
        'usuario',
        'presenca_pct',
        'nps',
        'form_completo',
        'cliques',
      ])
    );

    let totalForms = 0;
    let somaNps = 0;
    let totalPresentes = 0;

    for (const w of webinars) {
      const presencas = await presencaRepository.listarPorWebinar(w.id);
      const forms = await formularioRepository.listarPorWebinar(w.id);
      const npsByUser = new Map(forms.map((f) => [f.usuarioId, f]));

      const usuariosDoWebinar = new Set<string>([
        ...presencas.map((p) => p.usuarioId),
        ...forms.map((f) => f.usuarioId),
      ]);

      for (const jid of usuariosDoWebinar) {
        const presenca = presencas.find((p) => p.usuarioId === jid);
        const form = npsByUser.get(jid);
        if (presenca && presenca.percentual > 0) totalPresentes++;
        if (form?.completo) {
          totalForms++;
          somaNps += form.nps ?? 0;
        }
        const usuario = await webinarUserRepository.get(jid);
        linhas.push(
          this.toCsvLine([
            w.id,
            w.tema,
            w.dataHora.toISOString(),
            usuario?.username || jid,
            presenca ? Math.round((presenca.percentual ?? 0) * 100) : 0,
            form?.nps ?? '',
            form?.completo ? 'sim' : 'nao',
            'n/d', // cliques: não rastreável de forma confiável
          ])
        );
      }
    }

    const logs = await moderacaoLogRepository.listarRecentes(500);
    const npsMedio = totalForms ? (somaNps / totalForms).toFixed(1) : 'n/d';

    const resumo =
      `📊 *Relatório semanal de engajamento*\n\n` +
      `• Webinars no período: ${webinars.length}\n` +
      `• Participantes com presença: ${totalPresentes}\n` +
      `• Formulários completos: ${totalForms}\n` +
      `• NPS médio: ${npsMedio}\n` +
      `• Ações de moderação (recentes): ${logs.length}\n\n` +
      `_CSV detalhado em anexo. Cliques não são rastreados no WhatsApp (n/d)._`;

    return { csv: linhas.join('\n'), resumo };
  }

  /** Gera e envia o relatório ao admin configurado. */
  async enviarRelatorioSemanal(instance: string): Promise<void> {
    const destino = webinarConfig.adminReportJid;
    if (!destino) {
      console.warn('⚠️ [Reporting] ADMIN_REPORT_JID não configurado. Relatório não enviado.');
      return;
    }

    const { csv, resumo } = await this.gerarCsv();

    // Resumo em texto
    await evolutionApiService.sendText(instance, destino, resumo);

    // CSV como documento (base64)
    const base64 = Buffer.from(csv, 'utf-8').toString('base64');
    await evolutionApiService.sendMedia(instance, destino, {
      mediatype: 'document',
      media: base64,
      fileName: `relatorio-webinars-${new Date().toISOString().slice(0, 10)}.csv`,
      caption: 'Relatório semanal (CSV)',
    });

    console.log(`✅ [Reporting] Relatório semanal enviado para ${destino}`);
  }
}

export default new ReportingService();
