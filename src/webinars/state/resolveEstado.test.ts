import { describe, it, expect } from 'vitest';
import { resolveEstado } from './resolveEstado';
import { EstadoWebinar, WebinarStatus } from '../interfaces/webinar.interface';

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

// Início fixo de referência: 2026-07-01 20:00:00Z
const INICIO = new Date('2026-07-01T20:00:00.000Z');

function wb(status: WebinarStatus = 'scheduled') {
  return { dataHora: INICIO, status };
}

function at(offsetMs: number): Date {
  return new Date(INICIO.getTime() + offsetMs);
}

describe('resolveEstado', () => {
  it('IDLE quando ainda falta mais que D-7', () => {
    expect(resolveEstado(wb(), at(-8 * DIA))).toBe(EstadoWebinar.IDLE);
  });

  it('AQUECIMENTO exatamente em D-7', () => {
    expect(resolveEstado(wb(), at(-7 * DIA))).toBe(EstadoWebinar.AQUECIMENTO);
  });

  it('AQUECIMENTO em D-3', () => {
    expect(resolveEstado(wb(), at(-3 * DIA))).toBe(EstadoWebinar.AQUECIMENTO);
  });

  it('AQUECIMENTO em D-1', () => {
    expect(resolveEstado(wb(), at(-1 * DIA))).toBe(EstadoWebinar.AQUECIMENTO);
  });

  it('AQUECIMENTO até logo antes de 1h antes', () => {
    expect(resolveEstado(wb(), at(-HORA - 1))).toBe(EstadoWebinar.AQUECIMENTO);
  });

  it('DIA_D exatamente 1h antes', () => {
    expect(resolveEstado(wb(), at(-HORA))).toBe(EstadoWebinar.DIA_D);
  });

  it('DIA_D no horário de início', () => {
    expect(resolveEstado(wb(), at(0))).toBe(EstadoWebinar.DIA_D);
  });

  it('DIA_D durante a live (status scheduled/live, ainda não finished)', () => {
    expect(resolveEstado(wb('live'), at(2 * HORA))).toBe(EstadoWebinar.DIA_D);
  });

  it('COLETA quando finished e dentro de D+2', () => {
    expect(resolveEstado(wb('finished'), at(3 * HORA))).toBe(EstadoWebinar.COLETA);
  });

  it('COLETA finished em D+2 (limite)', () => {
    expect(resolveEstado(wb('finished'), at(2 * DIA))).toBe(EstadoWebinar.COLETA);
  });

  it('IDLE quando finished e passou de D+2', () => {
    expect(resolveEstado(wb('finished'), at(2 * DIA + 1))).toBe(EstadoWebinar.IDLE);
  });

  it('IDLE quando passou de D+2 mesmo sem finished', () => {
    expect(resolveEstado(wb('scheduled'), at(2 * DIA + 1))).toBe(EstadoWebinar.IDLE);
  });

  it('finished tem precedência: COLETA mesmo antes do início', () => {
    // Caso de borda: marcado finished cedo -> tratamos como COLETA enquanto <= D+2
    expect(resolveEstado(wb('finished'), at(-2 * HORA))).toBe(EstadoWebinar.COLETA);
  });
});
