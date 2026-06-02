import PDFDocument from 'pdfkit';
import { Webinar } from '../interfaces/webinar.interface';
import presencaRepository from '../repositories/PresencaRepository';
import formularioRepository from '../repositories/FormularioRepository';
import webinarUserRepository from '../repositories/WebinarUserRepository';
import { webinarConfig } from '../config/webinarConfig';

export interface CertificadoResultado {
  liberado: boolean;
  motivo?: string;
  /** PDF em base64 (sem prefixo data:) quando liberado. */
  base64?: string;
  fileName?: string;
}

/**
 * Geração e validação do certificado (spec §4 /certificado).
 *
 * Regra de aceite: presença > presencaMinima (default 80%) **E** formulário OK.
 */
class CertificateService {
  /**
   * Valida elegibilidade e, se ok, gera o PDF do certificado.
   */
  async emitir(usuarioJid: string, webinar: Webinar): Promise<CertificadoResultado> {
    const presenca = await presencaRepository.get(usuarioJid, webinar.id);
    const percentual = presenca?.percentual ?? 0;
    const formOk = await formularioRepository.isCompleto(usuarioJid, webinar.id);

    if (percentual < webinarConfig.presencaMinima) {
      const pct = Math.round(percentual * 100);
      const min = Math.round(webinarConfig.presencaMinima * 100);
      return {
        liberado: false,
        motivo: `Presença insuficiente: você esteve ${pct}% do tempo (mínimo ${min}%).`,
      };
    }

    if (!formOk) {
      return {
        liberado: false,
        motivo: 'Você ainda não preencheu o formulário (NPS). Responda-o para liberar o certificado.',
      };
    }

    const usuario = await webinarUserRepository.get(usuarioJid);
    const nome = usuario?.username || usuarioJid.split('@')[0];

    const base64 = await this.gerarPdf(nome, webinar);
    return {
      liberado: true,
      base64,
      fileName: `certificado-${webinar.id}.pdf`,
    };
  }

  /** Gera o PDF do certificado e retorna em base64. */
  private gerarPdf(nome: string, webinar: Webinar): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 50 });
        const chunks: Buffer[] = [];

        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
        doc.on('error', reject);

        const dataFmt = webinar.dataHora.toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        });

        doc
          .fontSize(34)
          .text('CERTIFICADO DE PARTICIPAÇÃO', { align: 'center' })
          .moveDown(1.5);

        doc
          .fontSize(16)
          .text('Certificamos que', { align: 'center' })
          .moveDown(0.5);

        doc.fontSize(28).text(nome, { align: 'center' }).moveDown(0.8);

        doc
          .fontSize(16)
          .text(`participou do webinar "${webinar.tema}",`, { align: 'center' })
          .text(`ministrado por ${webinar.palestrante}, em ${dataFmt}.`, { align: 'center' })
          .moveDown(2);

        doc
          .fontSize(12)
          .text(`Emitido em ${new Date().toLocaleDateString('pt-BR')}`, { align: 'center' });

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }
}

export default new CertificateService();
