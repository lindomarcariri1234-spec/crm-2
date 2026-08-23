# Núcleo de domínio turístico

## Objetivo

O VisiteCRM continua sendo um monólito modular. O núcleo turístico não cria uma
segunda aplicação nem uma tabela universal: ele fornece contratos compartilhados
para que CRM, vitrine, marketplace, parceiros, integrações, checkout,
comunicação e aplicativos evoluam com a mesma linguagem.

Os contratos executáveis vivem em `@workspace/shared` e não importam Drizzle,
Express, Clerk ou um provedor de pagamento. Adaptadores podem mapear as tabelas
atuais para esses contratos durante a migração.

## Fronteiras de domínio

| Módulo | Responsabilidade | Fonte atual durante a transição |
| --- | --- | --- |
| Identidade e tenancy | usuário, agência, operador, parceiro, fornecedor, permissões e escopo | `tenants`, `users`, `partners` |
| Catálogo e oferta | produto, experiência, viagem, origem, vendedor, preço, política e publicação | `store_products`, `catalog`, `trips` |
| Disponibilidade | capacidade, assentos, agenda, cotação externa e validade | `trips`, inventário da vitrine e futuros adaptadores |
| Pedido e reserva | carrinho, pedido, linha, retenção, reserva, voucher e pós-venda | `store_orders`, `store_order_items`, `reservations` |
| Pagamentos | autorização, confirmação, falha, reembolso e chargeback | `payments`, gateways existentes e webhooks |
| Resultado comercial | comissão contratual, repasse e reconciliação | `commissions`, regras de comissão e tarefas financeiras |
| Benefícios | bônus promocional, pontos, carteira, cashback e benefícios de parceiro | `referrals`, `loyalty` e futuros ledgers |
| Relacionamento | lead, prospect, cliente, defensor, origem, canal, consentimento e próxima ação | `clients`, `pipeline`, marketing e indicações |
| Comunicação | e-mail, WhatsApp, push, IA assistida, opt-in e handoff | `communication`, `conversations`, `messages` |

Um módulo pode chamar outro por contrato, mas não deve consultar diretamente
detalhes privados de seu armazenamento. A migração deve adicionar adaptadores e
depois mover consumidores; não renomear tabelas em massa.

## Modelo canônico

Todos os objetos de negócio têm `id` e `tenantId`. Os papéis são distintos:

- **agência** opera a relação comercial e a loja;
- **operador** executa uma viagem ou experiência;
- **parceiro** publica ou vende uma oferta;
- **fornecedor** entrega capacidade ou dados;
- **viajante** compra ou participa.

Um `TourismProduct` descreve o que existe. Um `TourismOffer` descreve como é
vendido, por quem, por qual origem, por qual preço e com qual disponibilidade.
Assim, uma viagem própria, um quarto de hotel de parceiro e uma experiência
obtida por API podem aparecer no mesmo catálogo sem apagar sua procedência.

`TourismOrder` é o agregado da compra e suas `TourismOrderLine` preservam o
vendedor por item. `TourismReservation` representa o atendimento operacional de
uma linha. Pagamento, comissão e benefício não são o mesmo saldo e possuem
referências e estados independentes.

## Eventos e idempotência

Os eventos canônicos têm envelope versionado e os campos:

- `eventId`, `eventVersion`, `type`, `occurredAt`;
- `tenantId`, `aggregateType`, `aggregateId`;
- `idempotencyKey`, `correlationId`, `causationId`, `actorId`;
- `data` específica do tipo.

Os tipos iniciais cobrem checkout iniciado, pedido criado, reserva retida,
reserva confirmada/cancelada, pagamento confirmado/reembolsado, comissão,
benefício e comunicação. A lista é deliberadamente pequena: novos tipos devem
representar uma mudança de negócio observável, não uma chamada interna.

Comandos repetidos usam `buildTourismIdempotencyKey` com tenant, agregado,
operação e um **identificador do efeito de negócio**. Por exemplo, cada
pagamento ou estorno deve usar o próprio `paymentId` e evento do provedor; uma
reentrega usa a mesma chave, mas parcelas diferentes nunca a compartilham.
`createTourismEvent` exige essa chave e confere que ela pertence ao mesmo
tenant, agregado e operação do envelope. A chave aceita somente identificadores
opacos. O validador rejeita sequências cruas ou formatadas que pareçam telefone
brasileiro, CPF ou cartão; telefone, e-mail, CPF, cartão e tokens nunca devem
ser incluídos. O consumidor deve persistir ou verificar a chave antes de aplicar
qualquer efeito externo.

## Autorização e isolamento

1. Toda leitura ou mutação recebe `tenantId` do contexto autenticado, nunca de
   um campo confiado do cliente.
2. Referências combinadas devem passar por `assertSameTenant`.
3. Superadmin pode operar em escopo de plataforma somente quando o endpoint
   autenticar o papel `superadmin` e construir no servidor um contexto com
   `authorizationScope: "platform"`; isso não transforma um tenant em outro.
4. Parceiros recebem apenas seus produtos, linhas, reservas, repasses e
   métricas; agência e operador recebem visões adicionais conforme a permissão.
5. Rotas públicas só expõem ofertas publicadas e dados deliberadamente
   públicos. Segredos de integração e dados pessoais ficam fora dos eventos e
   respostas públicas.

## Auditoria, privacidade e falhas

- Mudanças de catálogo, política, preço, disponibilidade, consentimento,
  cancelamento, repasse e permissão devem registrar ator, tenant, entidade,
  antes/depois e correlação na trilha de auditoria existente.
- Dados pessoais devem ser minimizados nos contratos. Eventos carregam
  referências, não telefones, e-mails ou documentos.
- Preço/disponibilidade externos devem ter `sourceRef`, validade e horário de
  consulta. Timeout ou divergência falha fechado: não confirma uma reserva nem
  cobra sem confirmação.
- Jobs e webhooks devem ser reentrantes. Reprocessar um evento pode atualizar
  observabilidade, mas não criar uma segunda reserva, comissão, benefício ou
  mensagem.
- Retenção deve seguir finalidade: histórico financeiro e auditoria têm
  retenção própria; conversas, eventos de navegação e dados de marketing devem
  permitir anonimização ou descarte conforme consentimento e política.

## Estratégia de evolução

1. Adaptar as tabelas atuais aos contratos, sem alterar URLs públicas.
2. Migrar primeiro leituras de catálogo e oferta, preservando `tripId`,
   `storeProductId`, `storeOrderId` e `reservationId` como referências legadas.
3. Migrar comandos de checkout/reserva para os eventos e chaves idempotentes,
   mantendo os efeitos atuais até a reconciliação comprovar equivalência.
4. Introduzir marketplace, integrações e liquidação apenas sobre os contratos;
   cada etapa deve ter testes de tenant, duplicidade, cancelamento e falha.
5. Remover um campo ou fluxo legado somente após métricas, auditoria e
   reconciliação demonstrarem que não há consumidores restantes.

## Mapeamento legado obrigatório

| Registro atual | Tenant canônico | Estado canônico | Observações |
| --- | --- | --- | --- |
| `store_orders` | `store_orders.tenant_id` | `pending`, `confirmed`, `processing`, `completed`, `cancelled` | O pedido mantém linhas, cupom, depósito, parcelas e chave de checkout. |
| `store_order_items` | pelo `orderId → store_orders.tenant_id`; alternativamente `productId → store_products.store_id → stores.tenant_id` | não possui estado próprio | Não tratar `productId` como tenant-scoped sem a junção. |
| `reservations` | `reservations.tenant_id` | inclui `failed`, além de pendente, confirmado, cancelado, concluído e reembolsado | A reserva continua referenciada por `storeOrderId`, quando existir. |
| `payments` | `payments.tenant_id` | `paid` mapeia para `confirmed`; `approved` mapeia para `authorized`; `overdue` permanece `overdue` | `installmentNumber`, `totalInstallments` e depósito precisam acompanhar o pagamento. |
| `store_products` | `storeProducts.store_id → stores.tenant_id` | `draft`, `published` e equivalentes são adaptados antes da leitura canônica | `tripId` e `partnerProductId` permanecem referências legadas até os adaptadores substituírem seus consumidores. |

Os adaptadores devem usar `mapLegacyStoreOrderStatus`,
`mapLegacyReservationStatus` e `mapLegacyPaymentStatus`; status desconhecido
falha de modo explícito. Antes de um comando cruzar módulos, o adaptador resolve
o tenant por essa tabela e aplica `assertSameTenant`.