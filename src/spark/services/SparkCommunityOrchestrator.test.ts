import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/sparkConfig', () => ({
  sparkConfig: {
    enabled: true,
    dmEnabled: false,
    evolutionInstance: 'instancia-teste',
    groupJid: '120363427851443399@g.us',
    adminJids: ['5511999999999@s.whatsapp.net'],
    schedulerEnabled: true,
    trialDays: 14,
    inactivityDays: 3,
    expiryLeadDays: 4,
    challengeTuesdayCron: '0 10 * * 2',
    challengeThursdayCron: '0 10 * * 4',
    lifecycleCron: '0 11 * * *',
    defaultKey: 'SPARK-TRIAL',
    activationUrl: 'https://example.com/ativar',
    appUrl: 'https://example.com/app',
    plansUrl: 'https://example.com/planos',
    plansText: 'Planos Spark',
    helpText: 'Ajuda Spark',
    mainMenuText: 'Menu Spark',
    challengeText: 'Desafio',
    challengeAnswerText: 'Resposta',
    challengeBonusText: 'Bonus',
    technicalQuestionText: 'Pergunta tecnica',
    appCtaText: 'CTA app',
    upgradeText: 'Upgrade',
    lowUsageDiagnosticText: 'Diagnostico',
    extensionText: 'Extensao',
    feedbackText: 'Feedback',
  },
}));

const { adminRepo, challengeRepo, repo, settingsRepo, messaging } = vi.hoisted(() => ({
  adminRepo: {
    isAdmin: vi.fn(),
  },
  challengeRepo: {
    findByWeekAndStatus: vi.fn(),
    upsert: vi.fn(),
    nextNumber: vi.fn(),
    publish: vi.fn(),
    listAnswers: vi.fn(),
    recordAnswer: vi.fn(),
    markBonus: vi.fn(),
    markAnswered: vi.fn(),
  },
  repo: {
    get: vi.fn(),
    ensure: vi.fn(),
    touchInteraction: vi.fn(),
    markMenuSent: vi.fn(),
    addGeneratedKey: vi.fn(),
    markKeyDelivered: vi.fn(),
    setUsageLevel: vi.fn(),
    save: vi.fn(),
    listChallengeParticipants: vi.fn(),
    markBonusSent: vi.fn(),
    listDueInactivity: vi.fn(),
    markInactivityPrompt: vi.fn(),
    listDueExpiry: vi.fn(),
    markExpiryPrompt: vi.fn(),
    markChallengeParticipation: vi.fn(),
  },
  settingsRepo: {
    get: vi.fn(),
  },
  messaging: {
    enviarDM: vi.fn(),
    enviarGrupo: vi.fn(),
    enviarGrupoComMencao: vi.fn(),
    enviarImagemGrupo: vi.fn(),
  },
}));

vi.mock('../repositories/SparkMemberRepository', () => ({
  default: repo,
}));

vi.mock('../repositories/SparkAdminRepository', () => ({
  default: adminRepo,
}));

vi.mock('../repositories/SparkChallengeRepository', () => ({
  default: challengeRepo,
}));

vi.mock('../repositories/SparkSettingsRepository', () => ({
  default: settingsRepo,
}));

vi.mock('./SparkMessagingService', () => ({
  default: messaging,
}));

import sparkCommunityOrchestrator from './SparkCommunityOrchestrator';

const challenge = {
  id: 'challenge-1',
  number: 1,
  weekKey: '2026-06-29',
  status: 'open',
  question: 'Qual o tipo de falta nesta curva?',
  options: {
    A: 'Monofásica-terra',
    B: 'Bifásica',
    C: 'Bifásica-terra',
    D: 'Trifásica',
  },
  correctOption: 'A',
  correctLabel: 'Monofásica-terra',
  explanation: 'Explicação técnica.',
} as any;

const payload = (jid: string, text = 'oi', pushName = 'Teste') =>
  ({
    event: 'messages.upsert',
    instance: 'instancia-teste',
    data: {
      key: { remoteJid: jid, fromMe: false, id: 'msg-1' },
      pushName,
      message: { conversation: text },
    },
  }) as any;

const groupPayload = (
  groupJid: string,
  participant = '137018214461678@lid',
  text = 'oi',
  pushName = 'Teste'
) =>
  ({
    event: 'messages.upsert',
    instance: 'instancia-teste',
    data: {
      key: { remoteJid: groupJid, participant, fromMe: false, id: 'msg-1' },
      pushName,
      message: { conversation: text },
    },
  }) as any;

describe('SparkCommunityOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.get.mockResolvedValue(null);
    repo.ensure.mockImplementation(async (jid: string, pushName: string, segmento: string) => ({
      jid,
      pushName,
      segmento,
      hasExistingKey: true,
      temChave: true,
      usageLevel: 'unknown',
      pendingFlow: null,
    }));
    settingsRepo.get.mockResolvedValue({
      dmEnabled: false,
      groupJid: '120363427851443399@g.us',
    });
    adminRepo.isAdmin.mockResolvedValue(false);
    challengeRepo.findByWeekAndStatus.mockResolvedValue(null);
    challengeRepo.nextNumber.mockResolvedValue(1);
    challengeRepo.upsert.mockResolvedValue(challenge);
    challengeRepo.publish.mockResolvedValue(challenge);
    challengeRepo.listAnswers.mockResolvedValue([]);
  });

  it('mantem Spark desligado para mensagens privadas', async () => {
    await expect(
      sparkCommunityOrchestrator.shouldHandleDirectMessage(
        payload('5511888888888@s.whatsapp.net', 'quanto custa o plano?'),
        'quanto custa o plano?'
      )
    ).resolves.toBe(false);
  });

  it('ignora mensagens privadas quando DM do Spark esta desabilitada', async () => {
    await sparkCommunityOrchestrator.onMessage(
      payload('5511888888888@s.whatsapp.net', 'quais os valores?'),
      'quais os valores?'
    );

    expect(repo.ensure).not.toHaveBeenCalled();
    expect(messaging.enviarDM).not.toHaveBeenCalled();
  });

  it('responde comando admin /spark help para JID autorizado', async () => {
    adminRepo.isAdmin.mockResolvedValue(true);
    await sparkCommunityOrchestrator.onMessage(
      groupPayload('120363427851443399@g.us', '5511999999999@s.whatsapp.net', '/spark help'),
      '/spark help'
    );

    expect(messaging.enviarGrupo).toHaveBeenCalledWith(
      'instancia-teste',
      '120363427851443399@g.us',
      expect.stringContaining('Comandos Spark admin:')
    );
  });

  it('responde spark no grupo Spark dentro do proprio grupo', async () => {
    await sparkCommunityOrchestrator.onMessage(
      groupPayload('120363427851443399@g.us', '137018214461678@lid', 'spark'),
      'spark'
    );

    expect(repo.ensure).toHaveBeenCalledWith(
      '137018214461678@lid',
      'Teste',
      expect.any(String),
      expect.any(Date)
    );
    expect(messaging.enviarGrupo).toHaveBeenCalledWith(
      'instancia-teste',
      '120363427851443399@g.us',
      expect.stringContaining('O que você precisa?')
    );
    expect(messaging.enviarDM).not.toHaveBeenCalled();
  });

  it('responde planos no grupo Spark dentro do proprio grupo', async () => {
    await sparkCommunityOrchestrator.onMessage(
      groupPayload('120363427851443399@g.us', '137018214461678@lid', 'quais os planos?'),
      'quais os planos?'
    );

    expect(messaging.enviarGrupo).toHaveBeenCalledWith(
      'instancia-teste',
      '120363427851443399@g.us',
      expect.stringContaining('💳 *Planos SPARK:*')
    );
    expect(messaging.enviarDM).not.toHaveBeenCalled();
  });

  it('dispara desafio semanal no grupo Spark configurado pelo painel', async () => {
    await expect(sparkCommunityOrchestrator.sendWeeklyChallenge()).resolves.toMatchObject({
      sent: true,
      target: '120363427851443399@g.us',
      challengeId: 'challenge-1',
    });

    expect(messaging.enviarGrupo).toHaveBeenCalledWith(
      'instancia-teste',
      '120363427851443399@g.us',
      expect.stringContaining('⚡ *Desafio da Semana #1*')
    );
  });

  it('gera bonus internamente quando DM esta desabilitada, mas envia resposta no grupo', async () => {
    challengeRepo.findByWeekAndStatus.mockResolvedValue(challenge);
    challengeRepo.listAnswers.mockResolvedValue([
      {
        id: 'answer-1',
        challengeId: 'challenge-1',
        weekKey: challenge.weekKey,
        memberJid: '5511888888888@s.whatsapp.net',
        pushName: 'Teste',
        option: 'A',
        correct: true,
      },
    ]);

    const result = await sparkCommunityOrchestrator.sendWeeklyAnswerAndBonus();

    expect(result).toMatchObject({
      sent: true,
      target: '120363427851443399@g.us',
      bonusSent: 1,
      correctAnswers: 1,
    });
    expect(messaging.enviarGrupo).toHaveBeenCalledWith(
      'instancia-teste',
      '120363427851443399@g.us',
      expect.stringContaining('📊 *Resultado do Desafio #1*')
    );
    expect(challengeRepo.markBonus).toHaveBeenCalledWith('answer-1', expect.stringMatching(/^SPARK-BONUS-/));
    expect(messaging.enviarDM).not.toHaveBeenCalled();
  });

  it('entrega chave no grupo Spark sem tentar DM para participante @lid', async () => {
    repo.get.mockResolvedValue({
      jid: '137018214461678@lid',
      pushName: 'Teste',
      segmento: 'B',
      hasExistingKey: true,
      temChave: false,
      usageLevel: 'unknown',
      pendingFlow: null,
    });
    repo.ensure.mockImplementation(async (jid: string, pushName: string, segmento: string) => ({
      jid,
      pushName,
      segmento,
      hasExistingKey: true,
      temChave: false,
      usageLevel: 'unknown',
      pendingFlow: null,
    }));

    await sparkCommunityOrchestrator.onMessage(
      groupPayload('120363427851443399@g.us', '137018214461678@lid', 'preciso da chave'),
      'preciso da chave'
    );

    expect(messaging.enviarGrupo).toHaveBeenCalledWith(
      'instancia-teste',
      '120363427851443399@g.us',
      expect.stringContaining('🔑 Sua chave de acesso')
    );
    expect(repo.markKeyDelivered).toHaveBeenCalledWith('137018214461678@lid');
    expect(messaging.enviarDM).not.toHaveBeenCalled();
  });

  it('novo membro no grupo recebe pergunta inicial antes de receber chave', async () => {
    repo.ensure.mockImplementation(async (jid: string, pushName: string, segmento: string) => ({
      jid,
      pushName,
      segmento,
      temChave: false,
      usageLevel: 'unknown',
      pendingFlow: null,
    }));

    await sparkCommunityOrchestrator.onMessage(
      groupPayload('120363427851443399@g.us', '137018214461678@lid', 'oi'),
      'oi'
    );

    expect(repo.save).toHaveBeenCalledWith('137018214461678@lid', { pendingFlow: 'ask_existing_key' });
    expect(messaging.enviarGrupoComMencao).toHaveBeenCalledWith(
      'instancia-teste',
      '120363427851443399@g.us',
      expect.stringContaining('Você já tem sua chave de acesso ao app?'),
      '137018214461678@lid'
    );
    expect(repo.markKeyDelivered).not.toHaveBeenCalled();
  });
});
