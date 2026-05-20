interface RateLimitData {
  count: number;
  firstRequestTime: number;
}

/**
 * Utilitário de proteção contra ataques de Flood.
 * Mantém um controle em memória utilizando técnica de Sliding Window simplificada.
 */
class RateLimiter {
  private limits = new Map<string, RateLimitData>();
  
  // Regra: Máximo de 5 requisições a cada 3 segundos por usuário
  private readonly MAX_REQUESTS = 5;
  private readonly WINDOW_MS = 3000;

  constructor() {
    // Garbage collection para evitar memory leaks caso a API rode por meses ininterruptos.
    // Limpa registros velhos a cada 15 minutos.
    setInterval(() => this.cleanup(), 15 * 60 * 1000);
  }

  /**
   * Avalia e computa requisições, retornando true se o limite foi excedido.
   * Execução O(1) com mínimo impacto computacional.
   */
  public isRateLimited(jid: string): boolean {
    if (!jid) return false;

    const now = Date.now();
    const userLimit = this.limits.get(jid);

    // Primeira vez ou a janela de tempo anterior já expirou
    if (!userLimit || (now - userLimit.firstRequestTime > this.WINDOW_MS)) {
      this.limits.set(jid, { count: 1, firstRequestTime: now });
      return false;
    }

    userLimit.count++;
    
    // Bloqueia caso ultrapasse
    return userLimit.count > this.MAX_REQUESTS;
  }

  /**
   * Limpa a memória de JIDs antigos que já não tem tráfego na janela.
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, value] of this.limits.entries()) {
      if (now - value.firstRequestTime > this.WINDOW_MS) {
        this.limits.delete(key);
      }
    }
  }
}

export default new RateLimiter();
