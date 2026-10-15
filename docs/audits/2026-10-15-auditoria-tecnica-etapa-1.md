# Auditoria técnica — etapa 1: isolamento multi-tenant e permissões

**Data:** 15 de outubro de 2026
**Situação:** revisão de acesso entre agências concluída no inventário das rotas. Foram corrigidas cinco falhas confirmadas nesta etapa e foram adicionados testes direcionados. As etapas 2–8 da sequência abaixo continuam fora do escopo desta revisão.

## Escopo desta rodada

Foi priorizada a fronteira de segurança entre Clerk, usuário local, agência e papel. A revisão manual cobriu:

- `artifacts/api-server/src/app.ts`: middleware Clerk e ordem de montagem da API.
- `artifacts/api-server/src/routes/index.ts`: inventário e montagem dos 67 módulos de rotas; não há uma autorização global aplicada ao router.
- `artifacts/api-server/src/lib/tenant.ts`: resolução da identidade local, usuário inativo, tenant e estado de assinatura.
- `lib/permissions/src/index.ts`: papéis e matriz central de permissões.
- `artifacts/api-server/src/routes/users.ts`, `team.ts`, `onboarding.ts`, `tenants.ts` e os controles administrativos de `admin.ts`.
- Leitura representativa de listagem/detalhe de viagens e reservas em `trips.ts` e `reservations.ts`, incluindo a projeção de dados para clientes.
- Revisão de autorização das rotas de assinatura/faturas em `subscriptions.ts`, do histórico/envio em `outbound-messages.ts`, da comunicação interna em `communication.ts` e da caixa de entrada em `chatbot.ts`.
- Busca de atribuições de `req.tenantId`, uso de `tenantId` vindo de requisição, políticas RLS e testes com fixtures de mais de um tenant.

Na segunda rodada, o inventário AST enumerou os 610 handlers `router.get/post/put/patch/delete/all` distribuídos pelos 67 módulos. A classificação final foi: 563 rotas autenticadas (incluindo guards de domínio), 33 rotas públicas sem sessão e 14 webhooks/cron. As exceções sem `requireAuth` inline foram revisadas individualmente: `/guide/auth` exige código de guia; `/partner/login` emite credencial de parceiro; `/onboarding/check-slug`, health checks e `/` são públicos; os dois métodos de `/system-configs` e `/trips/:id/costs/:costId` reutilizam handlers autenticados.
O inventário automatizado não substitui uma auditoria geral de frontend, schema, RLS e integrações; esses itens continuam nas etapas posteriores.

### Inventário por classe de acesso

- A matriz de famílias privadas, guardas, escopo e evidências de teste está em [`2026-10-15-matriz-rotas-privadas.md`](2026-10-15-matriz-rotas-privadas.md).
- **Públicas sem sessão (33):** `/`, `/health`, `/healthz`, `/health/auth`, `/onboarding/check-slug`, `/guide/auth` (código de guia), `/partner/login` (credencial de parceiro), `/nps/respond`, `GET /public/store/:slug/distribution/offers`, `GET /club/config`, `GET /club/benefits`, `GET /club/ranking` e as rotas de catálogo, assento, pedido, indicação, cupom, review e alerta de preço sob `/public/store/:slug` em `store-public.ts`.
- **Webhook/cron (14):** `ALL /cron/:job`; webhooks Evolution, Resend, Stripe e MercadoPago em `webhooks.ts`; `/webhooks/stripe`; callbacks Instagram/Zernio e callbacks de exclusão de dados em `instagram-messaging.ts`; e `POST /public/store/:slug/infinitepay/webhook`.
- **Autenticadas (563):** todas as demais declarações de método/path nos 67 módulos montados em `routes/index.ts`; incluem sessão Clerk e guardas de domínio, como JWT de guia, `requireClientAccess`, administradores de integração/distribuição e handlers compartilhados. Nenhum router global as autentica implicitamente.

## Coberto e evidências

1. **Identidade e tenant não vêm de um header controlado pelo cliente.** `requireAuth` resolve o usuário local pelo `userId` validado pelo Clerk e obtém o tenant do registro local. A busca por atribuições de `req.tenantId` encontrou essa atribuição central; não encontrou middleware que aceite um tenant ID de header.
2. **A guarda comum rejeita identidades ausentes ou inativas.** `requireAuth` retorna 401 sem sessão/usuário local e 403 para usuário inativo. Para usuários de agência, verifica o estado do tenant antes de permitir as rotas protegidas. Os caminhos diretos revisados em `/users/me`, sincronização de usuário, onboarding e promoção de superadmin também contêm verificações próprias de atividade.
3. **A matriz de papéis é negada por padrão para papéis desconhecidos.** `hasPermission` retorna `false` se papel, recurso ou ação não estiverem na matriz. A matriz limita financeiro e exclusão de reservas para gerente; o comentário do pacote alerta corretamente contra substituir essas permissões por `MANAGEMENT_ROLES`.
4. **Os caminhos revisados de equipe e usuários mantêm o escopo da agência.** Listagem, atualização e desativação de usuários, convites e membros filtram pelo `me.tenantId`. O convite de equipe aceita apenas o papel de vendedor. Administradores não podem atribuir o papel de superadmin.
5. **Provisionamento de agência tem controles de concorrência e papel.** Onboarding verifica atividade, papel e ausência de tenant; a transação bloqueia e revalida a linha do usuário antes de criar/associar o tenant.
6. **Administração global exige papel explícito.** As rotas administrativas e de gestão de tenants revisadas chamam `requireAuth` e verificam `SUPER_ADMIN`; a promoção inicial também exige correspondência com `SUPERADMIN_CLERK_ID` e usuário local ativo.
7. **A matriz concede leitura de viagens/reservas a clientes, mas os caminhos revisados restringem os registros ao próprio vínculo.** Viagens são limitadas às viagens associadas às reservas do cliente e formatadas sem custos e dados de documentos de motoristas. Reservas são limitadas ao registro de cliente ligado ao usuário. Listagens administrativas/restritas também adicionam o tenant do usuário.
8. **Não foi confirmado acesso cruzado nas rotas centrais revisadas.** Os testes direcionados passaram: `inactive-user-auth`, `payments-authz`, `users-auth`, `free-passenger-seat-conflict`, `clients-cpf` e `pipeline-deal-linkage` — 162 testes no total. Há testes com cenários de tenant cruzado em 32 arquivos de teste, mas isso não demonstra cobertura completa da API.
9. **A revisão anterior confirmou e corrigiu quatro lacunas de autorização.** Os detalhes estão em A4–A7; os testes focados daquela rodada passaram (43 testes em quatro suítes). A8 registra a quinta falha confirmada nesta etapa.
10. **O inventário das rotas não revelou outras rotas públicas acidentais.** As 33 rotas sem sessão foram classificadas como catálogo/loja pública, conteúdo público do clube/NPS, health, autenticação por código/token ou verificação pública; os 14 webhooks/cron permanecem em grupo separado e usam seus próprios mecanismos de validação.
11. **Uma referência de reserva enviada pelo cliente podia cruzar agências durante o check-in.** Em `POST /trips/:id/checkins` e `POST /guide/trip/:tripId/checkins`, a consulta comprovava que o passageiro pertencia à viagem e ao tenant correto, mas o `reservationId` persistido era aceito do corpo sem comparação com a reserva real do passageiro. A correção usa `passengers.reservationId` da consulta já escopada e rejeita um valor divergente. Um teste negativo com passageiro/reserva da agência A e ID de reserva da agência B confirma que o check-in não é gravado.
12. **A busca estática de predicados por identificador foi seguida até os handlers candidatos.** Leituras e mutações sem `tenantId` no próprio `where` foram consideradas seguras somente quando precedidas por uma verificação tenant-scoped do pai ou protegidas por `SUPER_ADMIN`; rotas públicas usam slug de loja ou token limitado. As consultas globais restantes estão descritas como exceções abaixo, não como acesso de agência.
13. **A cobertura por família agora inclui um teste negativo de exportação financeira.** CSV produzido para a agência A exclui uma linha correspondente da agência B; filtros de agregações financeiras, importação em lote, backup e fan-out SSE foram verificados junto com os testes existentes (45 testes em sete suítes direcionadas passaram).

## Achados e riscos

### A1 — Isolamento depende das consultas da aplicação; não foram encontradas políticas RLS

**Prioridade:** risco arquitetural / defesa em profundidade; não é, por si só, uma exploração confirmada.

Não foram encontrados `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY` ou `FORCE ROW LEVEL SECURITY` nas migrações examinadas. O banco usa credenciais com acesso amplo e depende de cada handler/consulta aplicar o escopo correto. Isso aumenta o impacto de qualquer filtro esquecido, especialmente em SQL manual, consultas com joins, workers e novos endpoints.

**Ação recomendada:** avaliar uma política RLS gradual, com contexto de tenant transacional, auditoria de tabelas e testes de migração. Não habilitar RLS em massa sem mapear workers, webhooks, tarefas multi-tenant e rotas de superadmin: uma mudança ampla pode bloquear fluxos legítimos.

### A2 — A API não tem autorização global no router

**Prioridade:** risco de manutenção, não uma falha confirmada.

`routes/index.ts` monta os módulos sem uma guarda de autenticação comum. Portanto, cada endpoint precisa declarar autenticação, papel/permissão e escopo de dados individualmente. A composição é flexível, mas torna fácil uma rota nova esquecer um dos controles.

**Ação recomendada:** manter o inventário atualizado automaticamente e exigir revisão/teste de autenticação, permissão e tenant para cada rota nova. Só avaliar uma guarda global depois de preservar as rotas públicas e seus controles próprios.

### A3 — Cobertura de testes cruzados é ampla, mas não foi comprovada como sistemática

**Prioridade:** teste/prevenção.

Foram localizados cenários multi-tenant em 32 arquivos; não foi verificado nesta rodada se cada endpoint de leitura, exportação, mutação, stream e operação em lote tem controle negativo com dados dos dois tenants. O helper `hasPermission` também não tem suíte própria visível dentro de `lib/permissions`.

**Ação recomendada:** criar uma matriz rota × papel × tenant, usar fixtures simultâneas de dois tenants e exigir teste negativo para IDOR em cada família de endpoint.

### A4 — Leitura de faturamento e início de pagamentos não verificavam a permissão financeira

**Prioridade:** alta; falha de autorização confirmada e corrigida nesta rodada.

`GET /subscriptions/current` exigia autenticação, mas não a permissão `FINANCIAL.VIEW`, apesar de retornar dados da assinatura e faturas. `POST /invoices/:id/pix` e `POST /invoices/:id/stripe/checkout` verificavam o tenant da fatura, mas não exigiam `FINANCIAL.EDIT`; qualquer usuário autenticado da mesma agência podia iniciar a operação. O segundo endpoint também usava o tenant do usuário autenticado ao localizar/criar o cliente Stripe, em vez do tenant da fatura, incorreto no caminho de superadmin.

**Correção:** leitura exige `FINANCIAL.VIEW`; geração de PIX e PaymentIntent exige `FINANCIAL.EDIT`; a resolução do cliente Stripe usa `invoice.tenantId`. Os filtros de ownership e a exceção explícita de superadmin foram preservados. Testes negativos cobrem cliente, vendedor, suporte e gerente nas mutações, e cliente/vendedor/suporte na leitura; a suíte completa de assinaturas passou.

### A5 — Rotas de mensagens da agência aceitavam qualquer usuário autenticado

**Prioridade:** alta; falha de autorização confirmada e corrigida nesta rodada.

O histórico, exportação, stream, resumo de falhas, criação e repetição de mensagens chamavam somente `requireAuth`. Uma conta de cliente podia consultar o histórico amplo de mensagens da agência ou chamar a rota de criação com um destinatário direto; o serviço aceita destinatários diretos que não correspondem a um cliente e usa os canais configurados pela agência.

**Correção:** as rotas de mensagens agora exigem um papel em `ALL_STAFF_ROLES`; as rotas de reconciliação continuam restritas a administradores. O escopo por tenant nos serviços foi mantido. Testes confirmam que uma conta de cliente não lê o histórico nem inicia um envio.

### A6 — Comunicação interna estava acessível a contas de cliente

**Prioridade:** alta; falha de autorização confirmada e corrigida nesta rodada.

`GET /messages` retornava mensagens de toda a agência com apenas `requireAuth`, e `POST /messages` permitia enviar pelo canal configurado pela agência para qualquer usuário autenticado. As rotas adjacentes de consulta de clientes para mensagens, modelos e automações também não tinham uma barreira comum de equipe. A filtragem por tenant não impedia o acesso de uma conta de cliente ao conteúdo da própria agência.

**Correção:** leitura/envio de mensagens, consulta de destinatários, modelos e automações exigem `ALL_STAFF_ROLES`. Restrições administrativas já existentes para alterações de modelos/automações e permissões de gestão dos logs foram mantidas. Testes verificam que cliente não lê mensagens ou destinatários e não consegue enviar pela conta da agência.

### A7 — Caixa de entrada do chatbot não restringia acesso a membros da equipe

**Prioridade:** alta; falha de autorização confirmada e corrigida nesta rodada.

As rotas autenticadas de listagem de conversas, leitura de mensagens, criação de mensagens e resposta à conversa usavam somente `requireAuth`. Uma conta de cliente da agência podia tentar acessar o histórico compartilhado da caixa de entrada ou iniciar uma resposta, embora os registros estivessem corretamente filtrados pelo tenant.

**Correção:** todas as rotas privadas de `/chatbot-conversations` e `/chatbot-messages` agora exigem `ALL_STAFF_ROLES`; as regras administrativas específicas de alteração de operações e clientes foram mantidas. Testes confirmam que clientes não conseguem listar conversas nem enviar respostas.

### A8 — O check-in aceitava uma reserva de outra agência

**Prioridade:** alta para integridade e isolamento de relações; falha confirmada e corrigida nesta rodada.

As rotas de check-in de equipe e de guia confirmavam o passageiro pela viagem e pelo tenant, mas persistiam `reservationId` fornecido pelo chamador. Um operador autorizado na agência A podia, portanto, associar o check-in de um passageiro válido a um ID de reserva da agência B.

**Correção:** ambas as rotas agora selecionam `passengers.reservationId` junto com o passageiro, recusam um ID fornecido que não corresponda e persistem exclusivamente o ID retornado pela consulta tenant-scoped. O teste de regressão em `trip-media-delete.test.ts` cobre o corpo malicioso da agência B e confirma que nenhuma inserção ocorre.

## Resultado dos scanners

- **Dependências:** concluído; 0 vulnerabilidades retornadas nesta execução.
- **SAST:** concluído; 0 resultados retornados nesta execução.
- **HoundDog:** inconclusivo; falhou com `HOUNDDOG_SCHEMA_MISMATCH`. Não deve ser interpretado como ausência de achados.

## Verificação operacional fora do escopo da etapa 1

Uma tentativa anterior do workflow `artifacts/api-server: API Server` falhou com `artifacts/api-server/dist/index.mjs has no source fingerprint`. Após a correção das rotas, o workflow foi reiniciado, o bundle foi produzido e o servidor iniciou na porta 8080. A falha anterior não se reproduziu; isso não substitui os smoke checks de publicação previstos para a etapa 8.

## Limites e itens fora desta conclusão

- O inventário e a triagem de classificação/guards cobriram os 610 handlers. A revisão de queries de alto risco incluiu leituras, mutações, joins, SQL manual, exports e operações em lote; auditoria de fluxo de negócio de todas as consultas agregadas, exports, workers e integrações permanece nas etapas próprias abaixo.
- A matriz central foi comparada com os guards de papel encontrados. Exceções intencionais incluem endpoints de plataforma restritos a `SUPER_ADMIN`, rotas de domínio ainda sem recurso equivalente na matriz que usam `ADMIN_ROLES`/`MANAGEMENT_ROLES`, e acesso público ou por credencial em loja, guia, parceiros, webhooks e cron.
- Avaliar constraints/índices compostos e uma estratégia RLS gradual continua sendo o item A1; a auditoria de todas as tabelas e relações indiretas ainda não está concluída.
- Reexecutar HoundDog após a falha de esquema e inspecionar os resultados, caso a ferramenta volte a aceitar o formato.

## Sequência explícita da auditoria completa

| Etapa | Tema | Estado |
|---|---|---|
| 1 | Isolamento multi-tenant e permissões | **Concluída para acesso entre agências nas rotas** — inventário de 610 handlers, revisão dos guards/exceções e correção A8; RLS e auditoria abrangente de relações permanecem como riscos arquiteturais registrados em A1. |
| 2 | Autenticação, onboarding e administração | **Não iniciada como revisão integral** — esta rodada apenas verificou guardas centrais e provisionamento representativo. |
| 3 | Loja pública, pedidos e pagamentos | **Não iniciada** — revisar anonimato, lookup por token, preços, estoque, checkout, webhooks e recuperação. |
| 4 | Finanças, indicações e reservas | **Não iniciada integralmente** — cobertos somente controles de autorização e escopo em amostras/tests; faltam transições e reconciliações. |
| 5 | Integrações, uploads, filas e webhooks | **Não iniciada** — revisar assinatura, ownership, tenant alvo, retries, SSRF e segredos em logs. |
| 6 | Frontend e apps móveis | **Não iniciada** — verificar permissões de apresentação, armazenamento local, navegação e consistência com a API. |
| 7 | Banco, migrações, desempenho e infraestrutura | **Não iniciada integralmente** — inclui avaliar RLS, constraints, índices, migrações e limites operacionais. |
| 8 | Regressão final, segurança e builds | **Não iniciada** — repetir testes, scanners, builds e smoke checks após correções das etapas anteriores. |

## Critério de conclusão

Cada etapa só será marcada como concluída após registrar arquivos/linhas efetivamente revisados, endpoints e papéis cobertos, achados com severidade e evidência, correções implementadas, testes executados e lacunas remanescentes. A auditoria completa não está concluída nesta rodada.
