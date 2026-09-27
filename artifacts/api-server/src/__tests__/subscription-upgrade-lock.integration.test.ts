import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { acquireSubscriptionUpgradeLock } from "../lib/subscription-upgrade-lock.js";

describe("subscription upgrade advisory lock", () => {
  it("allows only one concurrent lock holder for a tenant", async () => {
    const tenantId = `upgrade-lock-test-${randomUUID()}`;
    const releaseFirst = await acquireSubscriptionUpgradeLock(tenantId);
    let releaseSecond: (() => Promise<void>) | undefined;
    let secondAcquired = false;
    let secondLockPromise: Promise<void> | undefined;

    try {
      secondLockPromise = acquireSubscriptionUpgradeLock(tenantId).then((release) => {
        releaseSecond = release;
        secondAcquired = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(secondAcquired).toBe(false);

      await releaseFirst();
      await secondLockPromise;
      expect(secondAcquired).toBe(true);
    } finally {
      await releaseFirst();
      if (secondLockPromise) await secondLockPromise;
      await releaseSecond?.();
    }
  });
});