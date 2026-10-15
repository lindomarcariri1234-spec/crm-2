# Auditoria técnica — etapa 1: isolamento multi-tenant e permissões

**Data:** 15 de outubro de 2026
**Situação:** parcial; revisão dos controles centrais e de fluxos representativos concluída. Foram corrigidas quatro falhas de autorização confirmadas. A leitura linha a linha de todas as rotas ainda não foi concluída.

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

Isto não equivale à inspeção linha a linha de todos os 67 módulos nem de todo o frontend, banco e integrações.
O inventário estático identificou 609 declarações `router.get/post/put/patch/delete` nos módulos de rotas; esse total não deve ser confundido com revisão manual individual.

## Coberto e evidências

1. **Identidade e tenant não vêm de um header controlado pelo cliente.** `requireAuth` resolve o usuário local pelo `userId` validado pelo Clerk e obtém o tenant do registro local. A busca por atribuições de `req.tenantId` encontrou essa atribuição central; não encontrou middleware que aceite um tenant ID de header.
2. **A guarda comum rejeita identidades ausentes ou inativas.** `requireAuth` retorna 401 sem sessão/usuário local e 403 para usuário inativo. Para usuários de agência, verifica o estado do tenant antes de permitir as rotas protegidas. Os caminhos diretos revisados em `/users/me`, sincronização de usuário, onboarding e promoção de superadmin também contêm verificações próprias de atividade.
3. **A matriz de papéis é negada por padrão para papéis desconhecidos.** `hasPermission` retorna `false` se papel, recurso ou ação não estiverem na matriz. A matriz limita financeiro e exclusão de reservas para gerente; o comentário do pacote alerta corretamente contra substituir essas permissões por `MANAGEMENT_ROLES`.
4. **Os caminhos revisados de equipe e usuários mantêm o escopo da agência.** Listagem, atualização e desativação de usuários, convites e membros filtram pelo `me.tenantId`. O convite de equipe aceita apenas o papel de vendedor. Administradores não podem atribuir o papel de superadmin.
5. **Provisionamento de agência tem controles de concorrência e papel.** Onboarding verifica atividade, papel e ausência de tenant; a transação bloqueia e revalida a linha do usuário antes de criar/associar o tenant.
6. **Administração global exige papel explícito.** As rotas administrativas e de gestão de tenants revisadas chamam `requireAuth` e verificam `SUPER_ADMIN`; a promoção inicial também exige correspondência com `SUPERADMIN_CLERK_ID` e usuário local ativo.
7. **A matriz concede leitura de viagens/reservas a clientes, mas os caminhos revisados restringem os registros ao próprio vínculo.** Viagens são limitadas às viagens associadas às reservas do cliente e formatadas sem custos e dados de documentos de motoristas. Reservas são limitadas ao registro de cliente ligado ao usuário. Listagens administrativas/restritas também adicionam o tenant do usuário.
8. **Não foi confirmado acesso cruzado nas rotas centrais revisadas.** Os testes direcionados passaram: `inactive-user-auth`, `payments-authz`, `users-auth`, `free-passenger-seat-conflict`, `clients-cpf` e `pipeline-deal-linkage` — 162 testes no total. Há testes com cenários de tenant cruzado em 32 arquivos de teste, mas isso não demonstra cobertura completa da API.
9. **Foram confirmadas e corrigidas quatro lacunas de autorização.** Os detalhes e os testes de regressão estão em A4–A7; os testes focados atualizados passaram (43 testes em quatro suítes).

## Achados e riscos

### A1 — Isolamento depende das consultas da aplicação; não foram encontradas políticas RLS

**Prioridade:** risco arquitetural / defesa em profundidade; não é, por si só, uma exploração confirmada.

Não foram encontrados `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY` ou `FORCE ROW LEVEL SECURITY` nas migrações examinadas. O banco usa credenciais com acesso amplo e depende de cada handler/consulta aplicar o escopo correto. Isso aumenta o impacto de qualquer filtro esquecido, especialmente em SQL manual, consultas com joins, workers e novos endpoints.

**Ação recomendada:** avaliar uma política RLS gradual, com contexto de tenant transacional, auditoria de tabelas e testes de migração. Não habilitar RLS em massa sem mapear workers, webhooks, tarefas multi-tenant e rotas de superadmin: uma mudança ampla pode bloquear fluxos legítimos.

### A2 — A API não tem autorização global no router

**Prioridade:** risco de manutenção, não uma falha confirmada.

`routes/index.ts` monta os módulos sem uma guarda de autenticação comum. Portanto, cada endpoint precisa declarar autenticação, papel/permissão e escopo de dados individualmente. A composição é flexível, mas torna fácil uma rota nova esquecer um dos controles.

**Ação recomendada:** completar o inventário endpoint por endpoint, classificando cada rota como pública, webhook/cron ou autenticada e registrando os controles esperados. Só depois avaliar uma guarda global compatível com as rotas públicas.

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

## Resultado dos scanners

- **Dependências:** concluído; 0 vulnerabilidades retornadas nesta execução.
- **SAST:** concluído; 0 resultados retornados nesta execução.
- **HoundDog:** inconclusivo; falhou com `HOUNDDOG_SCHEMA_MISMATCH`. Não deve ser interpretado como ausência de achados.

## Verificação operacional fora do escopo da etapa 1

Uma tentativa anterior do workflow `artifacts/api-server: API Server` falhou com `artifacts/api-server/dist/index.mjs has no source fingerprint`. Após a correção das rotas, o workflow foi reiniciado, o bundle foi produzido e o servidor iniciou na porta 8080. A falha anterior não se reproduziu; isso não substitui os smoke checks de publicação previstos para a etapa 8.

## O que ainda falta na etapa 1

- Revisar linha a linha os endpoints restantes dos 67 módulos, sobretudo `clients`, `referrals`, `payments`, `store`, `documents`, `reports`, `backup`, `tenant-integrations`, `support-tickets`, `distribution`, SSE e handlers de upload.
- Conferir cada leitura e escrita por ID: filtro de tenant no registro principal e nos joins, subconsultas, SQL manual, exportações, contagens e operações em lote.
- Revisar todos os usos de `ADMIN_ROLES`, `MANAGEMENT_ROLES` e verificações de papel antigas contra a matriz atual; documentar cada exceção operacional.
- Auditar todas as tabelas e relações indiretas por tenant, constraints/índices compostos, workers e caminhos com superadmin ou `tenantId` nulo/vazio.
- Reexecutar HoundDog após a falha de esquema e inspecionar os resultados, caso a ferramenta volte a aceitar o formato.

## Sequência explícita da auditoria completa

| Etapa | Tema | Estado |
|---|---|---|
| 1 | Isolamento multi-tenant e permissões | **Em andamento** — controles centrais e amostras de alto risco revisados; falta a inspeção integral das rotas, queries e relações. |
| 2 | Autenticação, onboarding e administração | **Não iniciada como revisão integral** — esta rodada apenas verificou guardas centrais e provisionamento representativo. |
| 3 | Loja pública, pedidos e pagamentos | **Não iniciada** — revisar anonimato, lookup por token, preços, estoque, checkout, webhooks e recuperação. |
| 4 | Finanças, indicações e reservas | **Não iniciada integralmente** — cobertos somente controles de autorização e escopo em amostras/tests; faltam transições e reconciliações. |
| 5 | Integrações, uploads, filas e webhooks | **Não iniciada** — revisar assinatura, ownership, tenant alvo, retries, SSRF e segredos em logs. |
| 6 | Frontend e apps móveis | **Não iniciada** — verificar permissões de apresentação, armazenamento local, navegação e consistência com a API. |
| 7 | Banco, migrações, desempenho e infraestrutura | **Não iniciada integralmente** — inclui avaliar RLS, constraints, índices, migrações e limites operacionais. |
| 8 | Regressão final, segurança e builds | **Não iniciada** — repetir testes, scanners, builds e smoke checks após correções das etapas anteriores. |

## Critério de conclusão

Cada etapa só será marcada como concluída após registrar arquivos/linhas efetivamente revisados, endpoints e papéis cobertos, achados com severidade e evidência, correções implementadas, testes executados e lacunas remanescentes. A auditoria completa não está concluída nesta rodada.
