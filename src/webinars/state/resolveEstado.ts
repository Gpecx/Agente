import { EstadoWebinar, Webinar } from '../interfaces/webinar.interface';
import { webinarConfig } from '../config/webinarConfig';

/**
 * Função PURA que deriva o estado do bot para um webinar específico, a partir
 * do horário atual e do status do webinar (spec §1).
 *
 * O estado NÃO é armazenado: vários webinars podem coexistir, cada um com seu
 * próprio estado calculado. Esta função é testada isoladamente.
 *
 * Janelas (configuráveis via webinarConfig):
 *   - AQUECIMENTO: D-7  -> 1h antes
 *   - DIA_D:       1h antes -> fim da live (status === 'finished')
 *   - COLETA:      fim da live -> D+2
 *   - IDLE:        fora de tudo
 *
 * @param webinar  Webinar avaliado (dataHora = início).
 * @param agora    Instante de referência (injetável p/ testes).
 */
export function resolveEstado(
  webinar: Pick<Webinar, 'dataHora' | 'status'>,
  agora: Date
): EstadoWebinar {
  const inicio = webinar.dataHora.getTime();
  const t = agora.getTime();

  const HORA_MS = 60 * 60 * 1000;
  const inicioAquecimento = inicio - webinarConfig.aquecimentoHorasAntes * HORA_MS;
  const inicioDiaD = inicio - webinarConfig.diaDHorasAntes * HORA_MS;
  const fimColeta = inicio + webinarConfig.coletaHorasDepois * HORA_MS;

  // Se a live já foi marcada como finalizada, entramos em COLETA até D+2,
  // independentemente de oscilações de horário.
  if (webinar.status === 'finished') {
    return t <= fimColeta ? EstadoWebinar.COLETA : EstadoWebinar.IDLE;
  }

  // Antes de tudo ou muito depois -> IDLE
  if (t < inicioAquecimento || t > fimColeta) {
    return EstadoWebinar.IDLE;
  }

  // [inicioAquecimento, inicioDiaD)
  if (t < inicioDiaD) {
    return EstadoWebinar.AQUECIMENTO;
  }

  // [inicioDiaD, inicio + ... ] enquanto não finalizado: DIA D.
  // Após o início e enquanto status !== 'finished', seguimos em DIA_D
  // (a transição para COLETA é disparada por status='finished' ou pelo cron +30min).
  return EstadoWebinar.DIA_D;
}
