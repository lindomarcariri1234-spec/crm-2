---
name: Referral credit reservation
description: Cashback de indicação precisa ser reservado atomicamente no checkout e apenas confirmado após o pagamento.
---

O saldo de cashback deve ser recalculado e reservado sob lock na mesma transação que cria o pedido. O efeito pós-pagamento confirma a reserva, sem somar o valor novamente; pedidos não pagos precisam liberar a reserva.

**Why:** Revalidar apenas no efeito diferido ainda permite que dois pedidos persistam o mesmo desconto antes da confirmação do pagamento.

**How to apply:** Ao alterar checkout, pagamentos, cancelamentos ou limpeza de pedidos abandonados, preserve a distinção entre reserva, confirmação e liberação do cashback.

## Estados terminais e recuperação

Qualquer caminho que devolva cashback reservado deve invalidar o pedido descontado na mesma transação. Replays e liquidação de valor zero precisam rejeitar pedidos cancelados/reembolsados antes e depois do lock. Abandono só pode invalidar após confirmar sob lock que não há recebimento pago.

**Why:** Devolver o saldo sem invalidar o preço permite reutilizar o mesmo desconto; depósitos mantêm o pedido com status de pagamento pendente, então o status sozinho não comprova abandono.

**How to apply:** Em retries, limpeza, cancelamento e reembolso, serialize pelo pedido, consulte recebimentos pagos e restaure apenas débitos comprovados. Falhas contábeis pós-pagamento devem retornar erro ao provedor/operador para permitir retry idempotente.

## Teste concorrente

Harnesses que simulam o banco precisam modelar o lock como pertencente à transação: múltiplos `FOR UPDATE` dentro da mesma transação são reentrantes, enquanto transações concorrentes aguardam a liberação.

**Why:** O efeito pós-pagamento relê a reserva dentro da mesma transação; um mutex global não reentrante cria deadlock artificial e mascara a concorrência real do PostgreSQL.

**How to apply:** Ao criar testes de corrida para checkout ou efeitos diferidos, mantenha uma fila global de transações, mas reutilize o mesmo lock durante toda a transação corrente.