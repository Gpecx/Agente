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

const { adminRepo, repo, settingsRepo, messaging } = vi.hoisted(() => ({
  adminRepo: {
    isAdmin: vi.fn(),
  },
  repo: {
    get: vi.fn(),
    ensure: vi.fn(),
    touchInteraction: vi.fn(),
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
  },
}));

vi.mock('../repositories/SparkMemberRepository', () => ({
  default: repo,
}));

vi.mock('../repositories/SparkAdminRepository', () => ({
  default: adminRepo,
}));

vi.mock('../repositories/SparkSettingsRepository', () => ({
  default: settingsRepo,
}));

vi.mock('./SparkMessagingService', () => ({
  default: messaging,
}));

import sparkCommunityOrchestrator from './SparkCommunityOrchestrator';

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
      temChave: false,
      usageLevel: 'unknown',
      pendingFlow: null,
    }));
    settingsRepo.get.mockResolvedValue({
      dmEnabled: false,
      groupJid: '120363427851443399@g.us',
    });
    adminRepo.isAdmin.mockResolvedValue(false);
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
      'Menu Spark'
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
      'Planos Spark\nhttps://example.com/planos'
    );
    expect(messaging.enviarDM).not.toHaveBeenCalled();
  });

  it('dispara desafio semanal no grupo Spark configurado pelo painel', async () => {
    await expect(sparkCommunityOrchestrator.sendWeeklyChallenge()).resolves.toEqual({
      sent: true,
      target: '120363427851443399@g.us',
    });

    expect(messaging.enviarGrupo).toHaveBeenCalledWith(
      'instancia-teste',
      '120363427851443399@g.us',
      'Desafio'
    );
  });

  it('pula bonus privado quando DM esta desabilitada, mas envia resposta no grupo', async () => {
    repo.listChallengeParticipants.mockResolvedValue([
      { jid: '5511888888888@s.whatsapp.net', lastBonusWeekSent: undefined },
    ]);

    const result = await sparkCommunityOrchestrator.sendWeeklyAnswerAndBonus();

    expect(result).toMatchObject({
      sent: true,
      target: '120363427851443399@g.us',
      bonusSent: 0,
      bonusSkipped: 1,
    });
    expect(messaging.enviarGrupo).toHaveBeenCalledWith(
      'instancia-teste',
      '120363427851443399@g.us',
      'Resposta'
    );
    expect(messaging.enviarDM).not.toHaveBeenCalled();
  });

  it('entrega chave no grupo Spark sem tentar DM para participante @lid', async () => {
    await sparkCommunityOrchestrator.onMessage(
      groupPayload('120363427851443399@g.us', '137018214461678@lid', 'preciso da chave'),
      'preciso da chave'
    );

    expect(messaging.enviarGrupo).toHaveBeenCalledWith(
      'instancia-teste',
      '120363427851443399@g.us',
      expect.stringContaining('Chave: *SPARK-TRIAL*')
    );
    expect(repo.markKeyDelivered).toHaveBeenCalledWith('137018214461678@lid');
    expect(messaging.enviarDM).not.toHaveBeenCalled();
  });
});
