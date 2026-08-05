# Transcrever

App pessoal para transcrever áudio e vídeo em texto, pelo celular. Seleciona
um arquivo, envia, e o [Gemini](https://ai.google.dev) transcreve a fala
diretamente (aceita áudio e vídeo, sem precisar extrair o áudio antes).
Guarda um histórico das transcrições anteriores.

Protegido por uma senha única (app de uma pessoa só, sem contas). Testado
localmente de ponta a ponta com Postgres real e uma chamada real à API do
Gemini antes do deploy.

## Stack

Next.js (App Router) + Prisma + PostgreSQL + NextAuth v5 (Credentials + JWT)
— mesmo padrão do app "Meu Dia". Upload de arquivo grande via
[Vercel Blob](https://vercel.com/docs/vercel-blob) (upload direto do
navegador, contorna o limite de 4.5 MB de uma Vercel Function). Transcrição
via `@google/genai`, modelo `gemini-3.5-flash`.

## Rodando localmente

```bash
npm install
```

Crie um `.env` (veja `.env.example`) com `DATABASE_URL`, `APP_PASSWORD`,
`AUTH_SECRET`, `GEMINI_API_KEY` e `BLOB_READ_WRITE_TOKEN`.

```bash
npx prisma migrate dev --name init   # só na primeira vez
npm run dev
```

## Deploy (Vercel + Postgres + Blob + Gemini) — passo a passo

1. **Importar o projeto**: em vercel.com, "New Project" → importar este
   repositório. Não clicar em Deploy ainda.
2. **Banco de dados**: aba Storage → "Connect Database" → Postgres (Neon).
3. **Armazenamento de arquivos**: aba Storage → "Create Database" → **Blob**
   → criar um store novo (injeta `BLOB_READ_WRITE_TOKEN` automaticamente).
4. **Variáveis de ambiente** (Production + Preview + Development):
   - `DATABASE_URL` — confira se já existe (senão copie de
     `POSTGRES_URL_NON_POOLING`).
   - `APP_PASSWORD` — a senha do app.
   - `AUTH_SECRET` — gere com `openssl rand -base64 32`.
   - `GEMINI_API_KEY` — gerada em aistudio.google.com.
   - **Confira que cada valor foi realmente digitado** antes de salvar — um
     campo vazio causa erro `MissingSecret` sem aviso claro.
5. Disparar o deploy, testar login, subir um áudio curto de teste, conferir
   a transcrição e o histórico.
6. No Safari do iPhone: ícone de compartilhar → "Adicionar à Tela de
   Início".

## Estrutura

```
src/
  auth.ts, proxy.ts        # login por senha, protege todas as rotas
  lib/
    prisma.ts                # cliente singleton
    gemini.ts                 # upload + transcrição via Gemini
  app/
    login/page.tsx
    page.tsx + TranscreverClient.tsx   # tela principal + histórico
    api/
      auth/[...nextauth]/route.ts
      blob-upload/route.ts               # emite token de upload direto pro Blob
      transcriptions/route.ts + [id]/route.ts
```

## Limitações conhecidas

- Processamento é síncrono (uma requisição só, sem fila) — arquivos muito
  longos podem estourar o limite de tempo da function (`maxDuration = 60`).
  Suficiente para gravações pessoais comuns.
- O arquivo de mídia original é apagado do armazenamento depois de
  transcrito — só o texto fica salvo.
