# MyDay — tarefas por voz

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
- **Aviso falado**: o lembrete é lido em voz alta (voz em português do Android). Com a tela apagada o aviso toca e
  vibra; ao tocar nele o app abre e lê o lembrete. Ligue/desligue em Ajustes → Aviso falado.
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

Se **Vercel Authentication** estiver ligada para o endereço que você usa, o Chrome do Android **não
consegue baixar o manifest nem o service worker** (eles vêm sem cookie, e a Vercel responde com um
redirecionamento para o login dela): o app não instala e o cron leva 401. Os endereços de **preview**
(de branches) ficam sempre protegidos, então teste a instalação no endereço de **produção**.
Como checar: abra o endereço numa aba anônima do Chrome; se aparecer o login da Vercel, está bloqueado.
O app já tem login próprio por senha, então pode desligar em *Settings → Deployment Protection*
(ou usar um domínio próprio). Para manter a proteção e deixar só o cron passar, crie um
*Protection Bypass for Automation* e guarde como secret `VERCEL_BYPASS`.

### 4. Instalar no Android

Abra o endereço no **Chrome**, entre com a senha e use **Instalar o MyDay** (aba Ajustes) ou o menu ⋮ →
*Instalar app*. Depois, em Ajustes, **Ligar avisos** e **Enviar aviso de teste**.

## App Android (APK): gravar com a tela apagada e lembretes falados

O navegador não deixa um site gravar o microfone com a tela apagada nem falar com o app fechado; o Android só
permite isso a um app nativo. Por isso existe o **app Android do MyDay** (`android-app/`, Capacitor): uma casca
nativa que abre o mesmo MyDay e acrescenta:

- **Gravação com a tela apagada**: a gravação roda num serviço em primeiro plano (aparece a notificação
  "MyDay está gravando"), então continua com a tela apagada ou com outro app na frente. Até 15 minutos por gravação
  (AAC, cerca de 4 KB/s).
- **Lembretes falados com o app fechado**: cada tarefa com hora vira um **alarme do próprio celular**. No horário ele
  toca, vibra, acende a tela e **lê o lembrete em voz alta duas vezes**, mesmo com o app fechado, a tela apagada
  e depois de reiniciar o aparelho.

### Instalar

1. No celular, baixe o APK: **https://github.com/victormiller236-ops/Transcrever-app/releases/download/android-latest/MyDay.apk**
2. Abra o arquivo. Se o Android pedir, permita "instalar apps desta fonte" (é um app fora da Play Store). Se o
   Play Protect avisar, escolha "Instalar mesmo assim".
3. Abra o MyDay, entre com a senha e **permita Microfone e Notificações** quando o Android perguntar.
4. Em Ajustes → **Testar alarme falado (5 s)**: apague a tela e espere. Deve tocar e falar.

Novas versões usam a mesma assinatura: é só baixar e instalar por cima, sem desinstalar. O APK é compilado pelo
GitHub (`.github/workflows/android.yml`) a cada mudança em `android-app/` e publicado em Releases.

### O que vale saber

- Os alarmes são reagendados **sempre que o app abre ou as tarefas mudam**. Tarefa criada em outro aparelho só vira
  alarme neste depois que o MyDay for aberto nele.
- No app Android os avisos **não** vêm pelo push do servidor (o WebView não recebe Web Push): quem avisa é o alarme
  do aparelho. O push continua valendo para o MyDay instalado pelo Chrome.
- Em alguns celulares (Xiaomi, Samsung, Motorola…) o "economizador de bateria" mata apps em segundo plano. Se um
  alarme não tocar, libere o MyDay em Configurações → Apps → MyDay → Bateria → **Sem restrições**.
- O volume do lembrete falado usa o canal de **alarme** do Android.
- A tela de abertura e o ícone saem de `public/icons/logo.svg` (`node android-app/scripts/gen-android-icons.mjs`).
- Não testado em Android real por mim: o código foi compilado pelo GitHub e a integração com o app web foi testada
  com uma ponte simulada. O primeiro teste no seu celular é a verificação final.

## Limites que vale conhecer

- **Gravar com a tela apagada não é confiável em PWA.** O app mantém a tela acesa durante a gravação;
  se o Android cortar o microfone ao sair do app, processa o que foi gravado. Para gravar com a tela apagada,
  use o **app Android** (seção acima) ou grave no gravador do celular e escolha **Usar um arquivo de áudio**.
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
npm test            # unitários: datas, interpretador pt-BR, service worker, fala (rápidos, sem banco)
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
                reminder-text.ts (texto escrito/falado do aviso) · speech.ts (voz) · native.ts (ponte com o app Android)
                push.ts · tasks-shape.ts (validação) · audio.ts (microfone → WAV 16 kHz) · format.ts
src/app/        PautaApp.tsx (telas) · components/ · api/tasks · api/push · api/cron/dispatch · manifest.ts
public/         sw.js · offline.html · icons/ · screenshots/
android-app/    app Android (Capacitor): plugins em Java para gravar com a tela apagada e alarmes falados
tests/          unit · integration (API real) · e2e (Chromium)
```

Stack: Next.js 16 (App Router) · Prisma + PostgreSQL · NextAuth v5 · Gemini (`@google/genai`) · `web-push` · Vercel Blob (Transcrever).
