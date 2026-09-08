---
name: Referral credit reservation
description: Cashback de indicação precisa ser reservado atomicamente no checkout e apenas confirmado após o pagamento.
---

O saldo de cashback deve ser recalculado e reservado sob lock na mesma transação que cria o pedido. O efeito pós-pagamento confirma a reserva, sem somar o valor novamente; pedidos não pagos precisam liberar a reserva.

**Why:** Revalidar apenas no efeito diferido ainda permite que dois pedidos persistam o mesmo desconto antes da confirmação do pagamento.

**How to apply:** Ao alterar checkout, pagamentos, cancelamentos ou limpeza de pedidos abandonados, preserve a distinção entre reserva, confirmação e liberação do cashback.