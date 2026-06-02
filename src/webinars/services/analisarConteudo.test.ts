import { describe, it, expect } from 'vitest';
import { analisarConteudo } from './WebinarModerationService';

const PALAVROES = ['merda', 'idiota'];
const ALLOWLIST = ['youtube.com', 'zoom.us'];

describe('analisarConteudo', () => {
  it('libera mensagem limpa', () => {
    expect(analisarConteudo('bom dia pessoal', PALAVROES, ALLOWLIST).infracao).toBe(false);
  });

  it('detecta palavrão', () => {
    const r = analisarConteudo('que idiota', PALAVROES, ALLOWLIST);
    expect(r.infracao).toBe(true);
    expect(r.motivo).toContain('proibida');
  });

  it('libera link de domínio permitido', () => {
    expect(
      analisarConteudo('entra em https://youtube.com/live', PALAVROES, ALLOWLIST).infracao
    ).toBe(false);
  });

  it('libera subdomínio de domínio permitido', () => {
    expect(
      analisarConteudo('https://www.zoom.us/j/123', PALAVROES, ALLOWLIST).infracao
    ).toBe(false);
  });

  it('bloqueia link de domínio não permitido', () => {
    const r = analisarConteudo('compre em http://spam-shop.biz/promo', PALAVROES, ALLOWLIST);
    expect(r.infracao).toBe(true);
    expect(r.motivo).toContain('não autorizado');
  });

  it('não trata números decimais como link', () => {
    expect(analisarConteudo('o preço é 10.5 reais', PALAVROES, ALLOWLIST).infracao).toBe(false);
  });

  it('detecta link sem protocolo', () => {
    expect(analisarConteudo('acesse spam.xyz agora', PALAVROES, ALLOWLIST).infracao).toBe(true);
  });
});
