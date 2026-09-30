# Pauta — tarefas por voz

App pessoal, instalável no Android (PWA), para **falar** suas tarefas com dia e hora
e **receber o aviso no celular** na hora certa. Junto vem a aba **Transcrever**
(áudio/vídeo → texto), que já existia.

O logo é um homem de terno com maleta (`public/icons/logo.svg`).

## O que faz

- **Gravar pelo microfone** (ou importar um arquivo de áudio): o Gemini transcreve e já devolve
  as tarefas separadas, com data, hora, repetição, prioridade e antecedência do aviso.
  Você confere e ajusta antes de salvar. Uma fala pode gerar várias tarefas:
  *“amanhã às 9 reunião com a Ana, e sexta pagar o aluguel”*.
- **Adição rápida por texto**, com interpretador local em português (funciona sem IA):
  `amanhã às 15h ligar pro João urgente`, `toda segunda às 7 academia`,
  `daqui a 30 minutos tirar o bolo`, `dia 20 pagar a luz, me avise 1 hora antes`.
- **Avisos no celular** (Web Push) com botões **Concluir** e **Adiar 10 min** na própria notificação.
  Com o app aberto, o aviso aparece dentro dele, com som e vibração.
- Tarefas repetidas (todo dia/semana/mês), atrasadas, sem data, agenda por dia, desfazer em tudo.
- Instalável: ícone próprio, tela cheia, atalhos “Gravar tarefa” e “Nova tarefa”, tela “sem conexão”.

## Como funciona

```
Celular (PWA) ──voz──▶ /api/tasks/voice ──▶ Gemini (transcreve + estrutura, JSON validado)
      ▲                                              │
      │ push                                         ▼
      │                               Postgres (Task, PushSubscription)
Serviço de push ◀── web-push (VAPID) ◀── /api/cron/dispatch ◀── cron a cada 5 min
```

- Datas são guardadas em UTC; o **fuso do aparelho** (cabeçalho `x-tz`) interpreta “amanhã às 9h”.
  Repetições mantêm o horário de parede (09:00 continua 09:00 no horário de verão).
- O disparo é **seguro para rodar em paralelo**: cada tarefa é reivindicada com um UPDATE
  condicional, então nunca sai aviso duplicado. Falha passageira do serviço de push devolve a
  tarefa à fila; inscrição morta (404/410) é removida. Avisos com mais de 24 h de atraso são
  descartados em silêncio.
- O service worker **não guarda dados em cache** (tarefas são pessoais e atrás de senha).
  Só cuida de push, dos botões da notificação e da tela offline.

## Configuração (uma vez)

### 1. Variáveis de ambiente na Vercel

Além das que o app já usa (`DATABASE_URL`, `APP_PASSWORD`, `AUTH_SECRET`, `GEMINI_API_KEY`,
`BLOB_READ_WRITE_TOKEN`), adicione as dos avisos. Gere os valores com:

```bash
npm run vapid
```

| Variável | Para quê |
|---|---|
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Identidade do servidor junto ao serviço de push do Android |
| `VAPID_SUBJECT` | `mailto:` com o seu e-mail |
| `CRON_SECRET` | Senha que só o disparador de lembretes conhece |

Sem elas o app funciona normalmente, só não envia avisos (a tela Ajustes avisa).

### 2. Quem chama o disparador de lembretes

A Vercel Hobby só permite cron **uma vez por dia**, pouco para lembretes. Escolha um:

- **GitHub Actions (já incluído)** — `.github/workflows/lembretes.yml`, a cada 5 min.
  Em *Settings → Secrets and variables → Actions* crie `APP_URL` (ex.: `https://seu-app.vercel.app`)
  e `CRON_SECRET` (o mesmo da Vercel). O GitHub pode atrasar alguns minutos e pausa workflows
  agendados em repositório sem atividade por 60 dias.
- **cron-job.org (grátis, precisão de 1 min)** — crie um job `POST https://seu-app.vercel.app/api/cron/dispatch`
  a cada minuto, com o cabeçalho `Authorization: Bearer <CRON_SECRET>`.

Dica: “avisar 10 min antes” compensa qualquer atraso do disparador.

### 3. Proteção da Vercel

Se o projeto tem **Vercel Authentication** ligada, o Chrome do Android **não consegue baixar o
manifest nem o service worker** (vêm sem cookie) e o app não instala; o cron também leva 401.
O app já tem login próprio por senha, então desligue em *Settings → Deployment Protection*
(ou use um domínio próprio, que fica fora da proteção). Para manter a proteção só no cron, crie um
*Protection Bypass for Automation* e guarde como secret `VERCEL_BYPASS`.

### 4. Instalar no Android

Abra o endereço no **Chrome**, entre com a senha e use **Instalar o Pauta** (aba Ajustes) ou o menu ⋮ →
*Instalar app*. Depois, em Ajustes, **Ligar avisos** e **Enviar aviso de teste**.

## Limites que vale conhecer

- **Gravar com a tela apagada não é confiável em PWA.** O app mantém a tela acesa durante a gravação;
  se o Android cortar o microfone ao sair do app, processa o que foi gravado. Para ditar de bolso,
  use o gravador do celular e **Usar um arquivo de áudio**.
- A gravação vai até **1 min 50 s** (teto de 4,5 MB por requisição da Vercel). Áudios longos: aba Transcrever →
  **Criar tarefas**.
- Sem internet não dá para criar tarefas (não há fila offline); a tela “Sem conexão” aparece ao abrir.
- O aviso depende do disparador agendado; o horário exato é o do cron, não do segundo da tarefa.

## Desenvolvimento

```bash
npm install
cp .env.example .env     # preencha
npx prisma migrate dev
npm run dev
```

Testes:

```bash
npm test            # unitários: datas, interpretador pt-BR, service worker (rápidos, sem banco)
npm run typecheck
npm run test:e2e    # compila o app e sobe tudo de verdade: Postgres, Gemini e serviço de push falsos,
                    # Chromium emulando um Android (microfone simulado, instalabilidade, offline, push)
```

O `test:e2e` usa o Postgres em `TEST_DATABASE_URL` (padrão `postgresql://postgres@localhost:5433/tarefas?host=/tmp`,
já migrado) e o Chromium em `/opt/pw-browsers/chromium` (`CHROMIUM_PATH` para trocar).
Os ícones saem de `public/icons/logo.svg` com `npm run icons`.

## Estrutura

```
src/lib/        datetime.ts (fusos/repetição) · quickparse.ts (pt-BR) · voice.ts (Gemini) · reminders.ts (disparo)
                push.ts · tasks-shape.ts (validação) · audio.ts (microfone → WAV 16 kHz) · format.ts
src/app/        PautaApp.tsx (telas) · components/ · api/tasks · api/push · api/cron/dispatch · manifest.ts
public/         sw.js · offline.html · icons/ · screenshots/
tests/          unit · integration (API real) · e2e (Chromium)
```

Stack: Next.js 16 (App Router) · Prisma + PostgreSQL · NextAuth v5 · Gemini (`@google/genai`) · `web-push` · Vercel Blob (Transcrever).
