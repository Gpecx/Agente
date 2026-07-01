import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  moderationService,
  rateLimiter,
  groupConfigRepository,
  triagemService,
  sparkCommunityOrchestrator,
  participantService,
  webinarOrchestrator,
  messageArchiveRepository,
  summaryNoticeService,
} = vi.hoisted(() => ({
  moderationService: {
    extractText: vi.fn(),
    processMessage: vi.fn(),
  },
  rateLimiter: {
    isRateLimited: vi.fn(),
  },
  groupConfigRepository: {
    isGroupAllowed: vi.fn(),
  },
  triagemService: {
    handleIncomingDM: vi.fn(),
  },
  sparkCommunityOrchestrator: {
    shouldHandleDirectMessage: vi.fn(),
    onMessage: vi.fn(),
    onParticipantUpdate: vi.fn(),
  },
  participantService: {
    handleParticipantUpdate: vi.fn(),
  },
  webinarOrchestrator: {
    onMessage: vi.fn(),
    onParticipantUpdate: vi.fn(),
  },
  messageArchiveRepository: {
    archive: vi.fn(),
  },
  summaryNoticeService: {
    ensureNotice: vi.fn(),
  },
}));

vi.mock('../services/ModerationService', () => ({ default: moderationService }));
vi.mock('../utils/RateLimiter', () => ({ default: rateLimiter }));
vi.mock('../repositories/GroupConfigRepository', () => ({ default: groupConfigRepository }));
vi.mock('../triagem/services/TriagemService', () => ({ default: triagemService }));
vi.mock('../spark/services/SparkCommunityOrchestrator', () => ({ default: sparkCommunityOrchestrator }));
vi.mock('../services/ParticipantService', () => ({ default: participantService }));
vi.mock('../webinars/services/WebinarOrchestrator', () => ({ default: webinarOrchestrator }));
vi.mock('../repositories/MessageArchiveRepository', () => ({ default: messageArchiveRepository }));
vi.mock('../services/SummaryNoticeService', () => ({ default: summaryNoticeService }));

import webhookController from './WebhookController';

function createRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

const payload = (remoteJid: string, fromMe = false) => ({
  event: 'messages.upsert',
  instance: 'instancia-teste',
  data: {
    key: { remoteJid, fromMe, id: 'msg-1' },
    pushName: 'Teste',
    message: { conversation: 'oi' },
  },
}) as any;

describe('WebhookController direct messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TRIAGEM_ENABLED;
    rateLimiter.isRateLimited.mockReturnValue(false);
    moderationService.extractText.mockReturnValue('oi');
    sparkCommunityOrchestrator.shouldHandleDirectMessage.mockResolvedValue(false);
    sparkCommunityOrchestrator.onMessage.mockResolvedValue(undefined);
    triagemService.handleIncomingDM.mockResolvedValue(undefined);
    groupConfigRepository.isGroupAllowed.mockResolvedValue(false);
  });

  it('prioriza Spark em DM mesmo com triagem desabilitada', async () => {
    const req: any = { headers: {}, body: payload('5511888888888@s.whatsapp.net') };
    const res = createRes();
    sparkCommunityOrchestrator.shouldHandleDirectMessage.mockResolvedValue(true);

    await webhookController.handleEvolutionWebhook(req, res as any);

    expect(sparkCommunityOrchestrator.onMessage).toHaveBeenCalledWith(req.body, 'oi');
    expect(triagemService.handleIncomingDM).not.toHaveBeenCalled();
    expect(groupConfigRepository.isGroupAllowed).not.toHaveBeenCalled();
    expect(res.body).toEqual({ status: 'spark' });
  });

  it('envia DM sem intencao Spark para triagem quando habilitada', async () => {
    process.env.TRIAGEM_ENABLED = 'true';
    const req: any = { headers: {}, body: payload('5511888888888@s.whatsapp.net') };
    const res = createRes();

    await webhookController.handleEvolutionWebhook(req, res as any);

    expect(triagemService.handleIncomingDM).toHaveBeenCalledWith(req.body);
    expect(res.body).toEqual({ status: 'triagem' });
  });

  it('ignora DM sem intencao Spark quando triagem esta desabilitada', async () => {
    const req: any = { headers: {}, body: payload('5511888888888@s.whatsapp.net') };
    const res = createRes();

    await webhookController.handleEvolutionWebhook(req, res as any);

    expect(res.body).toEqual({ status: 'ignored', reason: 'Direct message not handled' });
  });

  it('continua bloqueando grupo nao autorizado pela whitelist', async () => {
    const req: any = { headers: {}, body: payload('120363000000000000@g.us') };
    const res = createRes();

    await webhookController.handleEvolutionWebhook(req, res as any);

    expect(groupConfigRepository.isGroupAllowed).toHaveBeenCalledWith('120363000000000000@g.us');
    expect(res.body).toEqual({ status: 'ignored', reason: 'Group not in whitelist' });
  });
});
