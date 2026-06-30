export type SparkSegmento = 'A' | 'B' | 'C';
export type SparkUsageLevel = 'unknown' | 'high' | 'low';
export type SparkPendingFlow = 'technical_question' | 'low_usage_diagnosis' | null;

export interface SparkMember {
  jid: string;
  pushName: string;
  segmento: SparkSegmento;
  temChave: boolean;
  chaveEntregueEm?: Date;
  usageLevel: SparkUsageLevel;
  joinedAt?: Date;
  lastInteractionAt?: Date;
  trialEndsAt?: Date;
  lastInactivityPromptAt?: Date;
  lastExpiryPromptAt?: Date;
  pendingFlow: SparkPendingFlow;
  challengeWeeks?: string[];
  lastBonusWeekSent?: string;
}
