# Auditoria técnica — etapas 3 e 4: loja, finanças, indicações e reservas

**Data:** 17 de outubro de 2026  
**Situação:** revisão direcionada concluída para os caminhos descritos abaixo. Não é uma auditoria integral do schema nem uma inspeção de dados de produção.

## Escopo revisado

- Loja pública em `artifacts/api-server/src/routes/store-public.ts`: resolução da loja por slug, pedido consultado por número + token, criação de PaymentIntent Stripe, checkout/confirmação/webhook InfinitePay e rota legada de associação de ID de pagamento.
- Administração da loja em `artifacts/api-server/src/routes/store.ts`: os 24 handlers administrativos revisados exigem `ADMIN_ROLES`; consultas e gravações usam a loja e o tenant autenticados.
- Indicações em `artifacts/api-server/src/routes/referrals.ts`: leitura, criação e exportação; autorização comparada com `COMMISSIONS.VIEW` e `COMMISSIONS.CREATE` em `lib/permissions/src/index.ts`.
- Relações consideradas: `store_products` → viagem, categoria e hospedagem; `store_orders` → loja, tenant, PaymentIntent, reservas e pagamentos; webhook Stripe → pedido pelo ID de pagamento; indicações → comissões e bônus.
- Logging HTTP: a URL registrada não inclui a query string, onde fica o token de consulta do pedido.

## Achados corrigidos

### 1. Associação de hospedagem sem isolamento de tenant

Criação e edição de produto validavam viagem e categoria, mas aceitavam `accommodationId` sem provar que a hospedagem pertencia ao tenant autenticado. A reserva posterior exige essa propriedade, então o vínculo podia falhar depois do checkout.

**Correção:** criação e edição verificam `accommodations.id` junto com `accommodations.tenantId`. A validação não foi ampliada para exigir que a hospedagem esteja ativa.

**Regressão:** `artifacts/api-server/src/__tests__/store-product-tenant-association.test.ts`.

### 2. Permissões amplas nas rotas de indicações

Algumas leituras e criação aceitavam `ALL_STAFF_ROLES`, embora a matriz de comissões negue leitura a suporte e limite criação a administrador/superadministrador.

**Correção:** consultas exigem `COMMISSIONS.VIEW`; criação exige `COMMISSIONS.CREATE`. Exports que já eram exceções administrativas continuam limitados a administradores.

**Regressão:** `artifacts/api-server/src/__tests__/referral-bonus.test.ts` confirma negativas para suporte e gerente sem permissão e criação permitida para administrador.

### 3. Associação pública de um ID de pagamento já usado por outro pedido

A rota pública legada `POST /public/store/:slug/orders/:orderNumber/payment-intent` aceitava um ID enviado pelo cliente e podia associá-lo a outro pedido da mesma loja. O webhook localiza o pedido pelo `paymentIntentId`, tenant e loja; um ID repetido tornava a atribuição ambígua.

**Correção:** a rota tornou-se idempotente: não cria associações nem aceita `paymentChargeId` informado pelo cliente. Ela só confirma um ID já atribuído pelo checkout do provedor e rejeita IDs presentes em outro pedido. Os fluxos Stripe e InfinitePay continuam atribuindo/confirmando seus próprios IDs no servidor.

**Compatibilidade:** não há chamador dessa rota no frontend atual. Clientes externos ou legados que ainda dependam de anexar IDs, inclusive de Mercado Pago, precisarão migrar para um fluxo que valide o vínculo no provedor.

**Regressões:** `artifacts/api-server/src/__tests__/store-public.test.ts` cobre tentativa de anexar um ID novo e duplicidade legada.

## Relações e limites observados

- A consulta pública do pedido é escopada por tenant, loja e número, e exige o token do pedido. A resposta pública não expõe o token armazenado nem campos internos de nota.
- O endpoint Stripe cria o PaymentIntent no servidor, informa `orderId`, `orderNumber` e `storeId` em metadata e grava o ID no pedido. O webhook de sucesso chama `applyGatewayPayment`, que filtra por tenant, loja e PaymentIntent e preserva idempotência.
- InfinitePay verifica o pagamento junto ao provedor antes de chamar a aplicação financeira; callbacks e retornos do navegador não são tratados como prova de pagamento.
- Os handlers administrativos da loja mantêm o escopo de tenant; o papel de administrador é aplicado em todos os 24 handlers revisados.

## Verificações

- Testes direcionados: 128 passaram em 3 arquivos (`store-public`, `referral-bonus` e `store-product-tenant-association`).
- `pnpm --filter @workspace/api-server run build` passou após as alterações.
- O workflow `api-typecheck` concluiu sem erros; inclui builds de `@workspace/db` e `@workspace/api-zod` e o typecheck do API Server.
- O workflow `artifacts/api-server: API Server` foi reiniciado após as alterações, reconstruiu o bundle e registrou `Server listening` na porta 8080. O Redis conectou; o contador diário de métricas Redis retornou o aviso `quota_exhausted`, sem impedir a inicialização.

## Lacunas que permanecem

1. Não foram auditadas todas as FKs, constraints e linhas legadas de pedidos, reservas, pagamentos, bônus e comissões; também não foi feita consulta de produção nem migração de dados.
2. O webhook ainda confia no vínculo já persistido do PaymentIntent; não foi feita uma reconciliação de metadata Stripe para todos os registros legados.
3. O fluxo antigo de anexação externa do Mercado Pago não foi reimplementado com consulta e conferência de `external_reference`/valor no provedor. A rota legada agora o recusa, e não há cliente atual no repositório que a chame.
4. Os testes de papel são direcionados às rotas críticas de indicação; não constituem uma matriz negativa para todos os handlers administrativos da loja.
5. A auditoria de finanças e reservas foi representativa: não cobre todas as transições, exports, estados concorrentes ou relações órfãs dos módulos.
