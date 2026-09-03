# Implantação na Vercel

Este repositório é preparado para **um único projeto Vercel**, com a raiz do
projeto apontando para a raiz deste monorepo. Esse projeto entrega o frontend
do VisiteCRM e uma única função serverless Express para todas as rotas da API.

## Configuração do projeto Vercel

No projeto VisiteCRM, deixe **Root Directory** vazio (a raiz do repositório).
O `vercel.json` na raiz define o build combinado do frontend e da API. O
`ignoreCommand` versionado em `scripts/vercel-ignore-build.sh` só ignora o
deploy quando nenhuma parte publicada nem seus pacotes internos mudou; por
isso, uma alteração somente em `artifacts/visitecrm/**` inicia um novo deploy
sem precisar alterar `vercel.json` junto.

Se o painel ainda mostrar `artifacts/api-server` como Root Directory, corrija
esse campo para a raiz do repositório antes do próximo deploy. A configuração
espelhada em `artifacts/api-server/vercel.json` mantém o critério seguro durante
essa transição, mas a raiz do monorepo é a configuração definitiva.

## Domínio canônico

O domínio público principal do VisiteCRM é:

```text
https://visitecrm.com
```

`www.visitecrm.com` deve permanecer cadastrado no mesmo projeto Vercel e
redirecionar para o domínio apex `https://visitecrm.com`. O alias
`visitecrm.vercel.app` também deve redirecionar para o domínio canônico; esse
último comportamento é reforçado no frontend por
`artifacts/visitecrm/src/main.tsx`.

### Como cadastrar ou revisar os domínios

1. Abra o projeto **VisiteCRM** no painel da Vercel.
2. Em **Settings → Domains**, adicione `visitecrm.com` e
   `www.visitecrm.com` caso ainda não estejam listados.
3. Defina `visitecrm.com` como domínio principal.
4. Configure o redirecionamento de `www.visitecrm.com` para
   `https://visitecrm.com`.
5. Não adicione os domínios a outro projeto Vercel.
6. Aguarde a validação DNS e a emissão do certificado HTTPS antes de trocar o
   DNS do domínio em produção.

### DNS

Os registros DNS devem ser aplicados no provedor autoritativo do domínio. A
Vercel é a fonte de verdade para os valores de validação: copie os registros
exibidos em **Settings → Domains** para cada host, sem substituir por valores
memorizados ou de outro projeto. Remova somente registros conflitantes para
`@` ou `www`; não altere nameservers nem outros registros sem autorização do
proprietário do domínio.

Depois de aplicar os registros, confirme no painel da Vercel que os dois hosts
estão com configuração válida e HTTPS ativo. A propagação pode demorar; não
considere o domínio pronto apenas porque o registro já aparece em uma consulta
DNS isolada.

### Origens, callbacks e links públicos

Depois de o apex estar validado, as URLs de produção devem usar
`https://visitecrm.com`, e não o alias `vercel.app`, nas variáveis aplicáveis:

```text
APP_URL
FRONTEND_URL
VITE_APP_URL
STORE_PUBLIC_BASE
STORE_PUBLIC_URL
CLIENT_PORTAL_URL
```

Revise também os callbacks que dependem do domínio:

```text
/api/uploadthing
/api/stripe/webhook
/api/webhooks/*
Google Calendar OAuth redirect
Clerk sign-in/sign-up redirects
```

Não coloque chaves ou secrets no repositório. Variáveis privadas continuam no
ambiente de produção da Vercel; apenas URLs públicas devem ser atualizadas
para o domínio canônico.

### Reparo operacional one-shot na base publicada

Reparos corretivos não são endpoints da API. O build da Vercel possui um
gancho **opt-in** que só executa quando um operador com acesso ao projeto
Vercel define temporariamente as variáveis abaixo no ambiente **Production** e
inicia um novo deploy. A função serverless publicada não contém uma rota para
esse reparo.

Para inspecionar uma reserva antes de alterar dados, defina no painel da
Vercel:

```text
VISITECRM_ONE_SHOT_REPAIR=orphan-reservation
VISITECRM_ONE_SHOT_REPAIR_APPLY=false
VISITECRM_ONE_SHOT_REPAIR_TENANT_ID=<tenant>
VISITECRM_ONE_SHOT_REPAIR_RESERVATION_ID=<id>
```

Em vez do ID, pode ser usado exatamente um número de reserva:

```text
VISITECRM_ONE_SHOT_REPAIR_RESERVATION_NUMBER=<numero>
```

Nunca defina os dois identificadores. O build imprime uma linha
`REPAIR_RESULT` com o status, a quantidade de assentos liberados e a
preservação do registro, sem imprimir `DATABASE_URL` nem qualquer outra
credencial.

Depois de conferir o dry-run nos logs do build, troque
`VISITECRM_ONE_SHOT_REPAIR_APPLY` para `true` e inicie outro deploy
intencionalmente. A aplicação exige o tenant e um único identificador,
bloqueia a reserva dentro de uma transação, cancela somente uma reserva órfã
ativa, libera seus assentos de forma atômica e grava uma entrada append-only
em `audit_logs`; a reserva original não é apagada. Reexecuções são seguras:
uma reserva já corrigida retorna `already-repaired` sem liberar assentos
novamente.

Assim que o resultado for confirmado, remova **todas** as variáveis
com prefixo `VISITECRM_ONE_SHOT_REPAIR` do ambiente Production no painel da
Vercel antes de qualquer outro deploy. Não copie a `DATABASE_URL` para o
shell, para um arquivo versionado ou para o chat: o build herda a credencial
privada já configurada na Vercel.

### Verificação mínima

Após a validação, confira:

```text
https://visitecrm.com
https://www.visitecrm.com
https://visitecrm.vercel.app
https://visitecrm.com/api/healthz
https://visitecrm.com/sign-in
```

O resultado esperado é:

- o apex carrega a aplicação sem redirecionar para `vercel.app`;
- `www` redireciona para o apex;
- o alias `vercel.app` redireciona para o apex;
- uma rota interna do SPA abre diretamente;
- `/api/healthz` responde pela mesma origem;
- o Clerk permite login e cadastro no domínio canônico;
- uploads, pagamentos, webhooks e links públicos usam o domínio final.

## Primeiro deploy

1. No painel da Vercel, importe o repositório GitHub e mantenha o **Root
   Directory** vazio (a raiz do repositório).
2. Selecione `pnpm` como gerenciador de pacotes. `vercel.json` já define os
   comandos de instalação, build, diretório estático, rewrites e cron jobs.
3. Crie um projeto Supabase Postgres de produção e copie a connection string
   com SSL para `DATABASE_URL` na Vercel. Use o pooler recomendado pelo
   Supabase para funções serverless quando ele estiver disponível.
4. Adicione as variáveis abaixo para os ambientes **Production** e
   **Preview** quando desejar que previews tenham backend próprio.
5. Faça o deploy. O build aplica as migrações, cria os planos ausentes e roda
   o backfill de credenciais antes de empacotar a função da API.

Não aponte `DATABASE_URL` da Vercel para o banco de desenvolvimento do
Replit. Cada ambiente deve ter seu próprio banco.

## Variáveis obrigatórias

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | Connection string SSL do Postgres Supabase deste ambiente. |
| `CREDENTIAL_ENCRYPTION_KEY` | Chave usada para criptografar integrações já salvas. Em um banco existente, mantenha exatamente a mesma chave; não a altere durante uma migração. |
| `CLERK_SECRET_KEY` | Chave secreta do mesmo ambiente Clerk da chave pública abaixo. |
| `VITE_CLERK_PUBLISHABLE_KEY` | Chave pública **live** do Clerk. Por ser `VITE_`, ela entra no build do frontend; não use uma chave secreta neste campo. |
| `UPLOADTHING_TOKEN` | Token do UploadThing para uploads de arquivos. |
| `SESSION_SECRET` | Segredo forte e aleatório para sessões/cookies legados. |
| `CRON_SECRET` | Segredo forte e aleatório usado pela Vercel Cron nos endpoints `/api/cron/*`. Sem ele, os endpoints recusam chamadas com HTTP 503. |
| `ENABLE_WORKERS` | Defina como `false`. A Vercel não mantém workers BullMQ persistentes; o app usa os fallbacks síncronos já existentes. |

## Variáveis necessárias conforme os recursos usados

| Recurso | Variáveis |
| --- | --- |
| E-mail (Resend) | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Mercado Pago / PIX | `MP_SECRET_KEY`, `MP_WEBHOOK_SECRET`, `PIX_KEY`, `PIX_NAME`, `PIX_CITY` |
| Redis / Upstash | `REDIS_URL`; ou `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` para métricas de uso. Redis é recomendado para rate limiting e fan-out de atualizações de assento. |
| Google Calendar | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI` |
| WhatsApp Z-API | `ZAPI_INSTANCE_ID`, `ZAPI_TOKEN` |
| Integrações de IA | `OPENAI_API_KEY` ou `AI_INTEGRATIONS_OPENAI_API_KEY`; opcionalmente `AI_INTEGRATIONS_OPENAI_BASE_URL` |
| URLs públicas | `APP_URL`, `STORE_PUBLIC_BASE` e/ou `STORE_PUBLIC_URL` com a URL HTTPS final da Vercel; `FRONTEND_URL`, `CLIENT_PORTAL_URL` e `ADDITIONAL_ORIGINS` quando usados pelo ambiente. |
| Administração e alertas | `SUPERADMIN_CLERK_ID`, `SUPERADMIN_EMAIL`, `SUPPORT_EMAIL`, `ABANDONED_REFERRAL_ALERT_EMAIL`, `ABANDONED_REFERRAL_ALERT_THRESHOLD` |
| Limites e observabilidade | `LOG_LEVEL`, `REDIS_DAILY_LIMIT_THRESHOLD_PCT`, `MAX_SEAT_STREAM_CONN_PER_IP`, `MAX_SEAT_STREAM_CONN_PER_TRIP`, `MAX_BOARDING_STREAM_CONN_PER_IP`, `MAX_BOARDING_STREAM_CONN_PER_TRIP` |

Defina `NODE_ENV=production` apenas se o painel não o fornecer
automaticamente. Não configure `PORT`: a função serverless recebe isso da
plataforma.

### Clerk

As chaves pública e secreta precisam pertencer à mesma instância Clerk. Para a
Vercel, informe `VITE_CLERK_PUBLISHABLE_KEY` diretamente no painel. A troca
automática usada nos previews do Replit é intencionalmente limitada ao Replit
e não se aplica à Vercel. Se a configuração Clerk exigir proxy próprio, adicione
também `VITE_CLERK_PROXY_URL` e `CLERK_PROXY_URL`.

Registre a URL de produção e as URLs de preview permitidas no painel Clerk,
incluindo os redirecionamentos de login/cadastro.

## Jobs agendados

Cada job pode ser acionado por:

```text
GET /api/cron/<nome-do-job>
Authorization: Bearer <CRON_SECRET>
```

A Vercel Cron faz chamadas `GET`. O endpoint também aceita `POST` para
provedores de scheduler que preferirem esse método. Nunca exponha
`CRON_SECRET` no frontend, em URLs ou em repositórios.

Os seguintes jobs são registrados no `vercel.json` uma vez por dia/semana. Os
horários estão em UTC (BRT = UTC-3):

No plano Hobby, a execução é processada dentro da hora agendada (a Vercel não
garante o minuto exato). Para trabalhos que exigem precisão por minuto, use
Vercel Pro ou um scheduler externo.

| Endpoint | Agenda UTC | Horário BRT |
| --- | --- | --- |
| `/api/cron/birthday` | `0 3 * * *` | 00:00 |
| `/api/cron/pipeline-trip-ended` | `0 5 * * *` | 02:00 |
| `/api/cron/uploadthing-orphan` | `0 5 * * *` | 02:00 |
| `/api/cron/client-scores` | `0 6 * * *` | 03:00 |
| `/api/cron/seat-reconciliation` | `0 7 * * *` | 04:00 |
| `/api/cron/abandoned-referrals` | `0 8 * * *` | 05:00 |
| `/api/cron/gemeo-alerts` | `0 9 * * *` | 06:00 |
| `/api/cron/gemeo-opportunities` | `0 10 * * 1` | segunda, 07:00 |
| `/api/cron/stripe-health` | `0 11 * * *` | 08:00 |
| `/api/cron/installment-due-reminder` | `0 11 * * *` | 08:00 |
| `/api/cron/trial-expiry` | `0 12 * * *` | 09:00 |
| `/api/cron/favorite-alerts` | `0 13 * * *` | 10:00 |

### Jobs subdiários

O plano Hobby da Vercel limita Cron Jobs a uma execução diária. Para manter os
jobs abaixo nos intervalos originais, use Vercel Pro ou um scheduler externo
(por exemplo, QStash, GitHub Actions ou cron-job.org) que chame os mesmos
endpoints autenticados:

| Endpoint | Intervalo original |
| --- | --- |
| `/api/cron/campaign-automation` | a cada hora |
| `/api/cron/whatsapp-outbox` | a cada 5 minutos |
| `/api/cron/chatbot-delivery` | a cada 5 minutos |
| `/api/cron/expired-reservations` | a cada 5 minutos |
| `/api/cron/email-retry` | a cada 15 minutos |
| `/api/cron/expiry-warning-retry` | a cada 15 minutos |
| `/api/cron/nps-dispatch` | todo hora, minuto 30 |
| `/api/cron/redis-daily-limit` | a cada hora |

Ao usar Vercel Pro, acrescente estes objetos ao array `crons` do
`vercel.json`:

```json
[
  { "path": "/api/cron/campaign-automation", "schedule": "0 * * * *" },
  { "path": "/api/cron/whatsapp-outbox", "schedule": "*/5 * * * *" },
  { "path": "/api/cron/chatbot-delivery", "schedule": "*/5 * * * *" },
  { "path": "/api/cron/expired-reservations", "schedule": "*/5 * * * *" },
  { "path": "/api/cron/email-retry", "schedule": "*/15 * * * *" },
  { "path": "/api/cron/expiry-warning-retry", "schedule": "*/15 * * * *" },
  { "path": "/api/cron/nps-dispatch", "schedule": "30 * * * *" },
  { "path": "/api/cron/redis-daily-limit", "schedule": "0 * * * *" }
]
```

## Atualização de assentos em tempo real (SSE)

O mapa de assentos usa Server-Sent Events. Uma função serverless não preserva
uma conexão para sempre: ela encerra conexões quando atinge o limite de duração
configurado. O cliente já reconecta quando a conexão cai, portanto uma breve
reconexão é esperada e não exige ação manual do usuário.

Com `REDIS_URL` configurada, o Redis publica cada atualização para as
instâncias que estiverem atendendo conexões SSE, mantendo o fan-out entre
instâncias. Sem Redis, a atualização em tempo real só alcança clientes ligados
à mesma instância que processou a alteração.

## Checklist após o deploy

1. Abra `/api/healthz` e confirme que responde.
2. Entre pelo Clerk e confirme uma chamada autenticada à API.
3. Crie um arquivo de teste via UploadThing, se uploads forem usados.
4. Configure os webhooks Stripe/Mercado Pago/UploadThing/Google Calendar com
   a URL pública final da Vercel, quando aplicável.
5. Execute, de forma controlada, um job seguro de cron com um `POST`
   autenticado e confirme o log da função.
6. Teste a reserva/checkout e uma alteração de assento em duas janelas do
   navegador.