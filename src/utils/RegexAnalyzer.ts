/**
 * Classe utilitária especializada na análise textual de mensagens utilizando Regex.
 * Aplica Clean Code ao isolar as regras complexas de string matching fora dos serviços de negócio.
 */
export class RegexAnalyzer {
  private static readonly FORBIDDEN_WORDS = ['palavrao1', 'palavrao2', 'ofensa3', 'spam4'];

  // Pré-compilada em memória para garantir máxima performance
  private static readonly FORBIDDEN_WORDS_REGEX = new RegExp(
    `\\b(${RegexAnalyzer.FORBIDDEN_WORDS.join('|')})\\b`,
    'i'
  );

  /**
   * Expressão regular avançada para capturar links:
   * - URLs padrão: https://exemplo.com
   * - Omissão de protocolo: www.exemplo.com
   * - Tentativas de ofuscação simples: google . com, bit. ly / xyz
   */
  private static readonly OBFUSCATED_URL_REGEX = /(?:https?:\/\/)?(?:www\s*\.\s*)?[a-zA-Z0-9-]+\s*\.\s*[a-zA-Z]{2,}(?:\s*\/\s*[^\s]*)?/gi;

  /**
   * Avalia se a string contém uma URL ou link ofuscado.
   */
  public static containsLink(text: string): boolean {
    if (!text) return false;
    
    // Reseta o estado interno da Regex (necessário devido à flag global 'g')
    this.OBFUSCATED_URL_REGEX.lastIndex = 0; 
    
    // Matcher extra para "google . com", ignorando falsos positivos como "10 . 5"
    return this.OBFUSCATED_URL_REGEX.test(text);
  }

  /**
   * Avalia se a string contém palavras proibidas ou profanidade explícita.
   */
  public static containsProfanity(text: string): boolean {
    if (!text) return false;
    
    // Expressões regulares instanciadas dinamicamente não precisam de reset de index se não usarem 'g', 
    // mas o fazemos por consistência de padrão.
    this.FORBIDDEN_WORDS_REGEX.lastIndex = 0;
    
    return this.FORBIDDEN_WORDS_REGEX.test(text);
  }
}
