import { describe, it, expect } from 'vitest';
import { adicaoConfirmada } from './TriagemService';

const JID = '5511999998888@s.whatsapp.net';

describe('adicaoConfirmada', () => {
  it('retorna false quando a resposta é vazia (request engolido pela fila)', () => {
    expect(adicaoConfirmada(undefined, JID)).toBe(false);
    expect(adicaoConfirmada(null, JID)).toBe(false);
    expect(adicaoConfirmada({}, JID)).toBe(false);
    expect(adicaoConfirmada([], JID)).toBe(false);
  });

  it('confirma quando o participante volta com status 200', () => {
    const resp = [{ jid: JID, status: '200' }];
    expect(adicaoConfirmada(resp, JID)).toBe(true);
  });

  it('confirma com status textual "success"', () => {
    const resp = { updateParticipant: [{ jid: JID, status: 'success' }] };
    expect(adicaoConfirmada(resp, JID)).toBe(true);
  });

  it('NÃO confirma quando a privacidade bloqueia (status 403/408)', () => {
    expect(adicaoConfirmada([{ jid: JID, status: '403' }], JID)).toBe(false);
    expect(adicaoConfirmada([{ jid: JID, status: 408 }], JID)).toBe(false);
  });

  it('casa o participante pelo número mesmo com sufixo de JID diferente', () => {
    const resp = [{ jid: '5511999998888@c.us', status: 200 }];
    expect(adicaoConfirmada(resp, JID)).toBe(true);
  });

  it('cai no primeiro item quando não há jid por entrada', () => {
    expect(adicaoConfirmada([{ status: 'ok' }], JID)).toBe(true);
    expect(adicaoConfirmada([{ status: 'error' }], JID)).toBe(false);
  });
});
