/**
 * Parser PURO de comandos do bot (spec §2.2, §4).
 *
 * WhatsApp não tem menu de comandos: comandos são apenas texto. Aceitamos
 * prefixo `/` ou `!`, case-insensitive, ignorando espaços extras.
 */

export type NomeComando =
  | 'proximo'
  | 'presente'
  | 'certificado'
  | 'ebook'
  | 'ajuda'
  | 'pergunta';

export interface ComandoParseado {
  comando: NomeComando;
  /** Texto após o nome do comando (ex.: o conteúdo de `/pergunta <texto>`). */
  args: string;
}

/** Comandos reconhecidos + aliases. */
const COMANDOS: Record<string, NomeComando> = {
  proximo: 'proximo',
  próximo: 'proximo',
  presente: 'presente',
  presença: 'presente',
  presenca: 'presente',
  certificado: 'certificado',
  ebook: 'ebook',
  'e-book': 'ebook',
  ajuda: 'ajuda',
  help: 'ajuda',
  comandos: 'ajuda',
  pergunta: 'pergunta',
  duvida: 'pergunta',
  dúvida: 'pergunta',
};

/**
 * Tenta interpretar um texto como comando.
 * @returns o comando parseado ou null se não for um comando.
 */
export function parseComando(textoBruto: string | null | undefined): ComandoParseado | null {
  if (!textoBruto) return null;

  const texto = textoBruto.trim();
  if (texto.length < 2) return null;

  // Precisa começar com / ou !
  const prefixo = texto[0];
  if (prefixo !== '/' && prefixo !== '!') return null;

  // Remove o prefixo e separa nome do comando dos argumentos
  const semPrefixo = texto.slice(1).trim();
  if (!semPrefixo) return null;

  // Primeiro token = nome do comando; resto = args
  const match = semPrefixo.match(/^(\S+)\s*([\s\S]*)$/);
  if (!match) return null;

  const nomeBruto = match[1].toLowerCase();
  const args = (match[2] || '').trim();

  const comando = COMANDOS[nomeBruto];
  if (!comando) return null;

  return { comando, args };
}
