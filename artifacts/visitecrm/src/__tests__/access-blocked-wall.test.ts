import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";

vi.mock("@clerk/react", () => ({
  useClerk: () => ({ signOut: () => Promise.resolve() }),
}));

import {
  AccessBlockedWall,
  extractBlockedCode,
  extractBlockedScope,
} from "../components/access-blocked-wall.js";
import { cleanupRoots, renderComponent } from "./eventSourceHarness.js";

afterEach(async () => {
  await cleanupRoots();
});

/**
 * Regression tests for distinguishing a tenant-access block on the user's
 * OWN account from a block on the TARGET tenant of a pending invite. Getting
 * this wrong means a vendor reads "your account is suspended" for an agency
 * they haven't even joined yet.
 */
describe("extractBlockedCode", () => {
  it("reads the code from an axios-style error response", () => {
    const err = { response: { data: { code: "TENANT_SUSPENDED" } } };
    expect(extractBlockedCode(err)).toBe("TENANT_SUSPENDED");
  });

  it("returns null for an unrecognized or missing code", () => {
    expect(extractBlockedCode({ response: { data: { code: "SOMETHING_ELSE" } } })).toBeNull();
    expect(extractBlockedCode({})).toBeNull();
    expect(extractBlockedCode(null)).toBeNull();
  });
});

describe("extractBlockedScope", () => {
  it("defaults to 'own' when the scope field is absent (e.g. pre-existing responses)", () => {
    expect(extractBlockedScope({ response: { data: { code: "TRIAL_EXPIRED" } } })).toBe("own");
    expect(extractBlockedScope({})).toBe("own");
  });

  it("recognizes 'invite_target' so the wall can show agency-appropriate copy", () => {
    const err = { response: { data: { code: "TRIAL_EXPIRED", scope: "invite_target" } } };
    expect(extractBlockedScope(err)).toBe("invite_target");
  });

  it("falls back to 'own' for any unexpected scope value", () => {
    expect(extractBlockedScope({ response: { data: { scope: "something_unexpected" } } })).toBe("own");
  });
});

describe("AccessBlockedWall rendering", () => {
  it("tells the signed-in user their own account is blocked when scope is 'own'", async () => {
    const { container } = await renderComponent(
      createElement(AccessBlockedWall, { code: "TENANT_SUSPENDED", scope: "own", onSignOut: () => {} }),
    );
    expect(container.textContent).toContain("Conta suspensa");
    expect(container.textContent).toContain("Esta conta foi suspensa");
    // Must never blame the invite target when the block is on the user's own account.
    expect(container.textContent).not.toContain("agência que te convidou");
  });

  it("tells a vendor the inviting agency is blocked, not their own account, when scope is 'invite_target'", async () => {
    const { container } = await renderComponent(
      createElement(AccessBlockedWall, { code: "TENANT_SUSPENDED", scope: "invite_target", onSignOut: () => {} }),
    );
    expect(container.textContent).toContain("Convite indisponível no momento");
    expect(container.textContent).toContain("agência que te convidou está com a conta suspensa");
    // Must never say "your account" — the signed-in user's own account is fine.
    expect(container.textContent).not.toContain("Esta conta foi suspensa");
  });

  it("defaults to 'own' scope when none is passed, preserving pre-existing callers", async () => {
    const { container } = await renderComponent(
      createElement(AccessBlockedWall, { code: "TRIAL_EXPIRED", onSignOut: () => {} }),
    );
    expect(container.textContent).toContain("Período de teste encerrado");
  });
});
