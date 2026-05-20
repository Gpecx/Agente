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
