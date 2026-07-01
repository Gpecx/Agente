export type SparkSegmento = 'A' | 'B' | 'C';
export type SparkUsageLevel = 'unknown' | 'high' | 'low';
export type SparkPendingFlow =
  | 'ask_existing_key'
  | 'ask_segment'
  | 'technical_question'
  | 'low_usage_diagnosis'
  | null;
export type SparkGeneratedKeyType = 'trial' | 'bonus' | 'extension';

export interface SparkGeneratedKey {
  type: SparkGeneratedKeyType;
  code: string;
  createdAt?: Date;
  reason?: string;
  challengeId?: string;
}

export interface SparkMember {
  jid: string;
  pushName: string;
  segmento: SparkSegmento;
  hasExistingKey?: boolean;
  temChave: boolean;
  chaveEntregueEm?: Date;
  usageLevel: SparkUsageLevel;
  appUsageCount?: number;
  joinedAt?: Date;
  lastInteractionAt?: Date;
  lastMenuAt?: Date;
  lastChallengeAnswerAt?: Date;
  trialEndsAt?: Date;
  lastInactivityPromptAt?: Date;
  lastExpiryPromptAt?: Date;
  pendingFlow: SparkPendingFlow;
  challengeWeeks?: string[];
  lastBonusWeekSent?: string;
  generatedKeys?: SparkGeneratedKey[];
}

export type SparkChallengeStatus = 'draft' | 'open' | 'answered' | 'closed';
export type SparkChallengeOption = 'A' | 'B' | 'C' | 'D';

export interface SparkChallenge {
  id: string;
  number: number;
  weekKey: string;
  status: SparkChallengeStatus;
  question: string;
  imageUrl?: string;
  options: Record<SparkChallengeOption, string>;
  correctOption: SparkChallengeOption;
  correctLabel: string;
  explanation: string;
  createdAt?: Date;
  publishedAt?: Date;
  answeredAt?: Date;
}

export interface SparkChallengeAnswer {
  id: string;
  challengeId: string;
  weekKey: string;
  memberJid: string;
  pushName: string;
  option: SparkChallengeOption;
  correct: boolean;
  answeredAt?: Date;
  bonusKey?: string;
}
