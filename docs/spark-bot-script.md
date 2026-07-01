# SPARK BOT — Script de Interação

**Canal:** WhatsApp Community | **CRM:** próprio

---

## ENTRADA — Novo membro

**BOT [imediato]**

> ⚡ Bem-vindo(a) à comunidade SPARK!
>
> Aqui você pratica, aprende e domina proteção de sistemas elétricos com quem vive isso no dia a dia.
>
> Você já tem sua chave de acesso ao app?

**[SIM]** → pula para Menu Principal
**[NÃO]** → continua abaixo

---

**BOT [3s depois]**

> Me conta: você é...
>
> 🎓 *A* — Estudante de engenharia
> 🔧 *B* — Técnico ou profissional de proteção
> 🏢 *C* — Empresa / uso corporativo

**[A ou B]** → entrega chave trial
**[C]** → "Perfeito! Um especialista vai entrar em contato em breve. 👍"

---

**BOT [após A ou B]**

> 🔑 Sua chave de acesso — *14 dias grátis:*
>
> `SPARK-XXXXXX`
>
> Como ativar:
> 1. Baixe: spark.voltsmind.com.br
> 2. Crie sua conta
> 3. Configurações → *Ativar licença* → cole a chave
>
> Qualquer dúvida, manda mensagem aqui. ⚡

---

## MENU PRINCIPAL

*Dispara quando membro manda qualquer mensagem*

**BOT**

> O que você precisa?
>
> 1️⃣ Minha chave de acesso
> 2️⃣ Planos e preços
> 3️⃣ Desafio técnico
> 4️⃣ Falar com especialista
> 5️⃣ Material de estudo

---

## DESAFIO SEMANAL

*Toda terça — postado no grupo*

**BOT**

> ⚡ *Desafio da Semana #N*
>
> [imagem: oscilografia ou diagrama]
>
> Qual o tipo de falta nesta curva?
>
> *A* — Monofásica-terra
> *B* — Bifásica
> *C* — Bifásica-terra
> *D* — Trifásica
>
> 🏆 Quem acertar recebe 7 dias extras no SPARK.
> Responde aqui: A, B, C ou D 👇

*[Na quinta-feira]*

**BOT**

> 📊 *Resultado do Desafio #N*
>
> ✅ Resposta certa: *[LETRA] — [tipo de falta]*
>
> [3 linhas de explicação técnica direta]
>
> 🏆 Acertaram: *[N] membros*
> ⚡ Primeiro a responder: *[Nome, Estado]*
>
> Veja a análise completa no app 📲

*[DM para quem acertou]*

**BOT**

> 🎉 Você acertou o desafio!
> Aqui estão seus *+7 dias* de SPARK:
> `SPARK-BONUS-XXXXX`

---

## REENGAJAMENTO

*Membro sem interação há 3 dias — DM*

**BOT**

> ⚡ Pergunta rápida de proteção:
>
> Qual a diferença prática entre o relé *50* e o *51* numa subestação de distribuição?
>
> *A* — Instantâneo vs temporizado
> *B* — Fase vs neutro
> *C* — São equivalentes
>
> Responde aqui — te mando a explicação. 👇

*[Após resposta]*

**BOT**

> ✅ *[Resposta correta com explicação de 2 linhas]*
>
> Quer ver um caso real no SPARK? Tenho um exercício exatamente sobre isso. 📲

---

## PRÉ-EXPIRAÇÃO DO TRIAL

*4 dias antes de vencer — DM*

**BOT**

> ⚡ Sua chave SPARK vence em *4 dias.*
>
> Você usou o app *[N] vezes* — já está no ritmo.
>
> Quer continuar? O plano Pro sai a *R$1,33/dia.*
>
> 👉 spark.voltsmind.com.br/planos

*[Se usou menos de 2 vezes]*

**BOT**

> ⚡ Sua chave vence em 4 dias e você mal usou ainda.
>
> O que travou?
>
> *A* — Não entendi como funciona
> *B* — Não tive tempo
> *C* — Não é o que eu precisava

**[A]** →

> "Te mando um vídeo de 2 minutos que resolve isso agora. 👇 [link]"

**[B]** →

> "Sem problema — estendo seu trial por mais 14 dias. Aproveita. 🔑 `SPARK-EXT-XXXXX`"

**[C]** →

> "Entendo. Me conta o que falta — isso vai direto pro time de produto."

---

## CONVERSÃO — PLANOS

*Dispara: membro pede preços*

**BOT**

> 💳 *Planos SPARK:*
>
> 🎓 *Student* — R$19,90/mês
> Para estudantes | Simulador + exercícios
>
> ⚡ *Pro* — R$39,90/mês
> Para profissionais | + análise de curvas + relatórios
>
> 🏆 *Premium* — R$79,90/mês
> Para equipes | + multi-usuário + suporte prioritário
>
> 📅 Anual: *17% de desconto* em todos os planos
>
> 👉 spark.voltsmind.com.br/planos

---

## SEQUÊNCIA RESUMIDA

```text
ENTRADA
  └─ Tem chave?
       NÃO → Segmenta (A/B/C) → Entrega chave
       SIM → Menu principal

TODA TERÇA
  └─ Desafio no grupo → Resposta quinta → DM bônus

DIA +3 sem interação
  └─ Pergunta técnica → Resposta → CTA app

DIA +10 (4 dias antes de expirar)
  └─ Usou bastante → CTA upgrade
  └─ Usou pouco   → Diagnóstico → Extensão ou feedback

QUALQUER MOMENTO
  └─ "planos" → Tabela de preços → Link
  └─ "chave"  → Reentrega + ativação
  └─ "ajuda"  → Especialista humano
```
