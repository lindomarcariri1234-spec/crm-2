---
name: Promise.all concurrent mock order
description: How db.select mock calls interleave when using Promise.all with two async functions in Vitest
---

## Rule

With `Promise.all([A(), B()])`, JavaScript evaluates both arguments synchronously before any microtask runs. Both A and B start executing until their first `await`. This means the first `db.select()` of each function happens in the synchronous phase:

- Call #1: A's first select (sync, during A()'s startup)
- Call #2: B's first select (sync, during B()'s startup)
- Call #3: A's second select (first microtask resolves → A resumes)
- Call #4: B's second select (next microtask → B resumes)

And so on, with subsequent calls interleaving at each `await` boundary.

**Why:** `selectCallCount % 2` is BROKEN for concurrent Promise.all — A gets call 1 (odd→settings), B gets call 2 (even→referrals), which is the wrong mock for B's settings query. The interleaving is deterministic with synchronous mock resolutions, not alternating odd/even.

**How to apply:** Always use `mockImplementationOnce` in the exact call order, never `callCount % N`. Document the expected order with comments. For N concurrent runs with K selects each, provide N*K `mockImplementationOnce` calls following the actual microtask interleaving trace.

For transaction fixtures that model `select(...).for("update")`, keep the lock result
outside the ordinary FIFO queue. The lock query is a separate terminal operation; if
the fixture consumes the first queue item for it, later payment/member/idempotency
responses shift and the race test can deadlock or exercise the wrong branch.

**Why:** The cancellation route acquires a reservation lock before its financial
reversal queries. Treating that lock as an ordinary select made the concurrent fixture
consume the payment response and wait forever at the second transaction gate.

**How to apply:** Let the mock chain carry a dedicated `for` response while ordinary
`select` calls consume their own queue. Also pass resolver functions to the thenable
chain; passing an array as the resolver silently resolves to `undefined`.

## Example (2 concurrent runs, 2 selects each)

```js
(db.select as ReturnType<typeof vi.fn>)
  .mockImplementationOnce(() => makeChain([makeTenantSetting()]))  // Run A call 1 (sync)
  .mockImplementationOnce(() => makeChain([makeTenantSetting()]))  // Run B call 2 (sync)
  .mockImplementationOnce(() => makeChain([makeReferral()]))       // Run A call 3 (microtask)
  .mockImplementationOnce(() => makeChain([makeReferral()]));      // Run B call 4 (microtask)
```
