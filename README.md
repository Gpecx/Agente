# 🛡️ Webhook Server — Evolution API Moderation Bot

Servidor Node.js de alta performance para recepção de webhooks da **Evolution API**, com sistema de moderação automática de grupos via WhatsApp, persistência no **Firestore** e tipagem estrita em **TypeScript**.

---

## 🏗️ Arquitetura

```
src/
├── config/
│   └── firebase.ts           # Inicialização do Firebase Admin SDK (Singleton)
├── controllers/
│   └── WebhookController.ts  # Recebe e autentica os webhooks, roteia os eventos
├── interfaces/
│   └── evolution.interface.ts # Tipagem estrita do payload da Evolution API
├── repositories/
│   └── StrikeRepository.ts   # Camada de persistência no Firestore (strikes)
├── routes/
│   └── webhook.routes.ts     # Mapeamento das rotas Express
└── services/
    ├── EvolutionApiService.ts # Cliente HTTP para ações na Evolution API
    └── ModerationService.ts  # Orquestração das regras de negócio
```

### Fluxo de uma mensagem

```
Evolution API → POST /webhook/evolution
    └─► WebhookController
            ├─ Valida header (WEBHOOK_SECRET)
            ├─ Ignora mensagens fromMe (anti-loop)
            └─ messages.upsert
                  └─► ModerationService.processMessage()
                          ├─ Extrai texto (conversation / extendedTextMessage)
                          ├─ Detecta URL ou palavra proibida (Regex)
                          ├─► StrikeRepository.registerStrike()   → Firestore (atômico)
                          ├─► EvolutionApiService.deleteMessage()  → Evolution API
                          │
                          ├─ strikeCount < MAX_STRIKES (3)?
                          │     └─► EvolutionApiService.sendTextWithMention() → aviso
                          └─ strikeCount >= MAX_STRIKES?
                                ├─► EvolutionApiService.removeParticipant()   → kick
                                ├─► EvolutionApiService.sendTextWithMention() → notificação
                                └─► StrikeRepository.resetStrikes()           → zera ficha
```

---

## 🚀 Como rodar

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar variáveis de ambiente

```bash
cp .env.example .env
# Edite o .env com suas credenciais reais
```

| Variável              | Descrição                                              |
|-----------------------|--------------------------------------------------------|
| `PORT`                | Porta do servidor (padrão: `3000`)                     |
| `WEBHOOK_SECRET`      | Token secreto enviado pela Evolution no header         |
| `FIREBASE_PROJECT_ID` | ID do projeto no Firebase                              |
| `FIREBASE_CLIENT_EMAIL` | Email da service account do Firebase Admin           |
| `FIREBASE_PRIVATE_KEY`| Chave privada da service account (com `\n` escapados)  |
| `EVOLUTION_API_URL`   | URL base da sua instância da Evolution API             |
| `EVOLUTION_API_KEY`   | API Key da Evolution                                   |

### 3. Rodar em desenvolvimento

```bash
npm run dev
```

### 4. Build para produção

```bash
npm run build
npm start
```

---

## 📡 Endpoints

| Método | Rota                    | Descrição                              |
|--------|-------------------------|----------------------------------------|
| `GET`  | `/health`               | Health check — retorna uptime e status |
| `POST` | `/webhook/evolution`    | Receptor de webhooks da Evolution API  |

---

## 🗄️ Estrutura do Firestore

```
groups/
  └── {remoteJid}/           # ID do grupo WhatsApp
        └── users/
              └── {participantJid}/   # ID do participante
                    ├── strikeCount: number
                    └── lastInfraction: Timestamp
```

---

## 🔒 Segurança

- O header `x-webhook-secret` ou `Authorization: Bearer <token>` é validado em toda requisição.
- Mensagens enviadas pelo próprio bot (`fromMe: true`) são ignoradas para evitar loops infinitos.
- O `.env` está no `.gitignore` — **nunca commite credenciais reais**.

---

## 🎓 Módulo Bot Webinars

Máquina de estados que cobre o ciclo de vida de um webinar (pré-evento, dia do
evento e pós-evento). Vive isolado em `src/webinars/` e é acoplado de forma
**aditiva** ao roteamento de webhook existente — não substitui a moderação-base.

### Máquina de estados

O estado é **calculado** por webinar (nunca um enum global), via a função pura
`resolveEstado(webinar, agora)`:

| Estado | Janela (relativa a `data_hora`) | Ação |
|---|---|---|
| `IDLE` | fora das janelas | só escuta |
| `AQUECIMENTO` | D-7 → 1h antes | teasers, enquetes, opt-in |
| `DIA_D` | 1h antes → fim da live | lembretes, `/presente`, moderação |
| `COLETA` | fim da live (`finished`) → D+2 | NPS, e-book, certificado |

### Componentes (`src/webinars/`)

```
state/resolveEstado.ts        # função pura testável (+ resolveEstado.test.ts)
config/webinarConfig.ts       # toda a config externalizada (env)
interfaces/webinar.interface.ts
repositories/                 # 1 repo por "tabela" (coleção Firestore)
services/
  WebinarOrchestrator.ts      # ponto de entrada (reação → moderação → comando → FAQ)
  WebinarCommandHandler.ts    # parser + dispatch dos comandos (+ commandParser.test.ts)
  WebinarModerationService.ts # link/palavrão (allowlist) + "mute" simulado + log
  WebinarReactionService.ts   # opt-in via reação
  WebinarParticipantService.ts# boas-vindas na entrada do grupo
  WebinarMessagingService.ts  # anti-ban: opt-in p/ DM, rate limit, enviarComOpcoes()
  WebinarCampaignService.ts   # ações proativas (teaser/lembrete/coleta)
  WebinarSchedulerService.ts  # node-cron: tick 1/min + relatório sexta 18h
  CertificateService.ts       # PDF do certificado (pdfkit)
  ReportingService.ts         # CSV semanal
  FaqService.ts               # dúvidas frequentes (configurável)
```

### Comandos (texto, prefixo `/` ou `!`, case-insensitive)

| Comando | Quando | O que faz |
|---|---|---|
| `/proximo` | sempre | data, tema e palestrante do próximo webinar |
| `/presente` | durante a live | registra presença (conta p/ certificado) |
| `/certificado` | pós-evento | valida presença > 80% **e** form → envia PDF no privado |
| `/ebook` | pós-evento | valida form → envia link no privado |
| `/pergunta <texto>` | sempre | registra dúvida para o host |
| `/ajuda` | sempre | lista os comandos |

### Persistência (Firestore — coleções)

> A spec original foi escrita para PostgreSQL (6 tabelas + migrações). Como o
> projeto usa **Firestore**, as entidades foram modeladas como **coleções**
> (sem migrações SQL). PK de usuário = **JID do WhatsApp**.

| Coleção | Equivalente à tabela | Doc id |
|---|---|---|
| `webinars` | `webinars` | id do webinar |
| `webinar_usuarios` | `usuarios` | **JID** |
| `perguntas` | `perguntas` | auto |
| `presencas` | `presencas` | `{webinarId}:{jid}` |
| `formularios` | `formularios` | `{webinarId}:{jid}` |
| `logs_moderacao` | `logs_moderacao` | auto |
| `cron_exec` | (idempotência) | `{webinarId}:{gatilho}` |

### ⚠️ Limitações do WhatsApp (importante)

O WhatsApp/Evolution API difere bastante do Telegram. As adaptações:

- **DM exige opt-in (anti-ban).** Enviar DM não solicitada em massa **bane**
  contas. DMs só são enviadas para quem deu **opt-in** (reagiu com o emoji de
  lembrete, default 🔥, ou interagiu com o bot). Envios em lote têm **rate limit
  + jitter humanizado**. Toda DM é logada. A boas-vindas na entrada do grupo, por
  padrão, é postada **no grupo** (não em DM) — `WEBINAR_WELCOME_DM=true` força a
  DM, mas é um **cenário de risco assumido**.
- **"Mute" é simulado.** Não existe mutar usuário no WhatsApp. O bot apaga a
  mensagem infratora, avisa por DM e marca o usuário como silenciado por 10 min
  (`silenciadoAte`): novas mensagens dele no grupo são **apagadas automaticamente**
  nessa janela. **Requer o bot como admin do grupo.**
- **Sem "pin".** Fixar mensagem é instável; usamos a **descrição do grupo** como
  info persistente (`atualizarInfoFixada()`), abstraído para troca futura.
- **Botões instáveis.** `enviarComOpcoes()` usa **texto numerado** ("Responda 1
  ou 2") como estratégia padrão e confiável.
- **Enquetes (polls)** e **rastreio de votos** são **best-effort** (instáveis).
- **Cliques** não são rastreáveis de forma confiável → reportados como `n/d` no CSV.
- **Scheduler best-effort.** O tick roda 1×/min e dispara gatilhos dentro de uma
  janela de grace; se o processo ficar fora do ar durante toda a janela de um
  gatilho, ele é pulado (idempotência garante que nunca duplica).

### Configuração

Todas as variáveis do módulo estão documentadas em `.env.example` (seção
*Módulo Bot Webinars*): emoji de opt-in, palavrões, allowlist de domínios,
JID do admin do relatório, % mínimo de presença, janelas dos estados, delays
anti-ban, instância e grupo da Evolution, base de FAQ, etc.

### Testes

```bash
npm test        # vitest run (resolveEstado, parser de comandos, analisador de conteúdo)
```

> Pré-requisitos operacionais: o bot precisa ser **admin do grupo** para apagar
> mensagens e moderar; defina `EVOLUTION_INSTANCE` e `WEBINAR_GROUP_JID` para que
> os crons consigam postar (eles não recebem o payload do webhook).

### Endpoints admin (após o deploy)

Todas protegidas pelo header `x-admin-key: <ADMIN_API_KEY>` (ou `Authorization: Bearer`).

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/api/admin/groups` | Libera um grupo na whitelist (sem isso o webhook ignora o grupo) |
| `GET` | `/api/admin/groups` | Lista grupos liberados |
| `DELETE` | `/api/admin/groups/:groupJid` | Remove grupo da whitelist |
| `POST` | `/api/admin/webinars` | Cria/atualiza webinar |
| `GET` | `/api/admin/webinars` | Lista webinars |
| `POST` | `/api/admin/webinars/:id/status` | Atualiza status (`finished` dispara a fase de COLETA) |

**1) Liberar o grupo** (necessário para o bot atuar nele):

```bash
curl -X POST https://SEU_HOST/api/admin/groups \
  -H "x-admin-key: SUA_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"groupJid":"1203630XXXXXXX@g.us"}'
```

**2) Cadastrar um webinar** (sem isso o bot fica em `IDLE` e nada acontece):

```bash
curl -X POST https://SEU_HOST/api/admin/webinars \
  -H "x-admin-key: SUA_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tema": "Deploy na prática",
    "dataHora": "2026-07-01T20:00:00-03:00",
    "palestrante": "Fulano",
    "linkSala": "https://zoom.us/j/123"
  }'
```

A resposta traz o `id` gerado. Use-o para encerrar a live (dispara o NPS +30min):

```bash
curl -X POST https://SEU_HOST/api/admin/webinars/<ID>/status \
  -H "x-admin-key: SUA_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"finished"}'
```
