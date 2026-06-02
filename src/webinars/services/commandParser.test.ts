import { describe, it, expect } from 'vitest';
import { parseComando } from './commandParser';

describe('parseComando', () => {
  it('reconhece /proximo', () => {
    expect(parseComando('/proximo')).toEqual({ comando: 'proximo', args: '' });
  });

  it('reconhece prefixo ! também', () => {
    expect(parseComando('!ajuda')).toEqual({ comando: 'ajuda', args: '' });
  });

  it('é case-insensitive', () => {
    expect(parseComando('/PRESENTE')).toEqual({ comando: 'presente', args: '' });
    expect(parseComando('/Certificado')).toEqual({ comando: 'certificado', args: '' });
  });

  it('ignora espaços extras antes e depois', () => {
    expect(parseComando('   /ebook   ')).toEqual({ comando: 'ebook', args: '' });
  });

  it('captura argumentos de /pergunta', () => {
    expect(parseComando('/pergunta Como faço o deploy?')).toEqual({
      comando: 'pergunta',
      args: 'Como faço o deploy?',
    });
  });

  it('preserva múltiplas linhas nos argumentos', () => {
    const r = parseComando('/pergunta linha1\nlinha2');
    expect(r?.comando).toBe('pergunta');
    expect(r?.args).toBe('linha1\nlinha2');
  });

  it('suporta aliases (próximo com acento, duvida, help)', () => {
    expect(parseComando('/próximo')?.comando).toBe('proximo');
    expect(parseComando('/duvida x')?.comando).toBe('pergunta');
    expect(parseComando('/help')?.comando).toBe('ajuda');
    expect(parseComando('/presença')?.comando).toBe('presente');
  });

  it('retorna null para texto sem prefixo de comando', () => {
    expect(parseComando('oi pessoal')).toBeNull();
    expect(parseComando('proximo')).toBeNull();
  });

  it('retorna null para comando desconhecido', () => {
    expect(parseComando('/banana')).toBeNull();
  });

  it('retorna null para entradas vazias/nulas', () => {
    expect(parseComando('')).toBeNull();
    expect(parseComando(null)).toBeNull();
    expect(parseComando(undefined)).toBeNull();
    expect(parseComando('/')).toBeNull();
    expect(parseComando('!  ')).toBeNull();
  });

  it('não confunde um link (http://) com comando', () => {
    expect(parseComando('http://site.com')).toBeNull();
  });
});
