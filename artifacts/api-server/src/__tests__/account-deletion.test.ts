import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  users: Symbol("users"),
  clients: Symbol("clients"),
  audit: Symbol("audit"),
  deleteClerk: vi.fn(),
  unlink: vi.fn(),
  broadcast: vi.fn(),
  calendar: vi.fn(),
  failInsert: false,
  state: { user: null as null | { id: string; clerkId: string; role: string; tenantId: string }, clients: [] as { id: string; tenantId: string; userId: string | null }[], ledger: null as null | { id: string; action: string; entityId: string; after: { clerkId: string; status: string; claimedAt?: string } } },
  lock: Promise.resolve() as Promise<unknown>,
}));

vi.mock("@workspace/db", () => {
  const makeDb = () => ({
    select: (projection?: Record<string, unknown>) => {
      let table: symbol;
      const execute = () => table === mocks.users
        ? mocks.state.user ? [mocks.state.user] : []
        : table === mocks.clients ? mocks.state.clients.filter(c => c.userId)
        : mocks.state.ledger && !(projection && "entityId" in projection && mocks.state.ledger.after.status === "done")
          ? [mocks.state.ledger] : [];
      const q = {
        from(t: symbol) { table = t; return q; },
        where() { return q; },
        limit() { return q; },
        for() { return Promise.resolve(execute()); },
        then(resolve: (v: unknown[]) => void) { return Promise.resolve(execute()).then(resolve); },
      };
      return q;
    },
    insert: () => ({
      values(value: typeof mocks.state.ledger) {
        if (mocks.failInsert) throw new Error("DB insert failed");
        mocks.state.ledger = value;
        return Promise.resolve();
      },
    }),
    delete: (table: symbol) => ({ where() {
      if (table === mocks.users) mocks.state.user = null;
      return Promise.resolve();
    } }),
    update: (table: symbol) => ({ set(values: { after?: { clerkId: string; status: string; claimedAt?: string }; userId?: null }) {
      return {
        where() {
          if (table === mocks.clients) mocks.state.clients.forEach(c => { c.userId = null; });
          const claimed = table === mocks.audit && mocks.state.ledger
            && (values.after?.status !== "processing" || mocks.state.ledger.after.status === "pending");
          if (claimed && values.after && mocks.state.ledger) mocks.state.ledger.after = values.after;
          return {
            then(resolve: (v: unknown[]) => void) { return Promise.resolve([]).then(resolve); },
            returning() { return Promise.resolve(claimed ? [{ id: mocks.state.ledger?.id }] : []); },
          };
        },
      };
    } }),
  });
  return {
    usersTable: mocks.users, clientsTable: mocks.clients, auditLogsTable: mocks.audit,
    db: {
      ...makeDb(),
      transaction<T>(fn: (tx: ReturnType<typeof makeDb>) => Promise<T>): Promise<T> {
        const run = async () => {
          const snapshot = structuredClone(mocks.state);
          try { return await fn(makeDb()); }
          catch (err) { mocks.state = snapshot; throw err; }
        };
        const result = mocks.lock.then(run);
        mocks.lock = result.catch(() => {});
        return result;
      },
    },
  };
});
vi.mock("@clerk/express", () => ({ clerkClient: { users: { deleteUser: mocks.deleteClerk } } }));
vi.mock("@workspace/permissions", () => ({ ROLES: { CLIENT: "cliente" } }));
vi.mock("../services/unlink-client-from-trips", () => ({ unlinkClientFromTrips: mocks.unlink }));
vi.mock("../lib/realtime", () => ({ broadcastSeatUpdate: mocks.broadcast }));
vi.mock("../lib/google-calendar/sync-service", () => ({ CalendarSyncService: { syncTrip: mocks.calendar } }));
vi.mock("../lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

import { findAccountDeletion, notifyDeletedClientTrips, prepareAccountDeletion, processAccountDeletion, retryPendingAccountDeletions } from "../services/account-deletion";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = {
    user: { id: "user-1", clerkId: "clerk-1", role: "cliente", tenantId: "tenant-1" },
    clients: [
      { id: "client-1", tenantId: "tenant-1", userId: "user-1" },
      { id: "client-2", tenantId: "tenant-1", userId: "user-1" },
      { id: "client-3", tenantId: "tenant-2", userId: "user-1" },
    ],
    ledger: null,
  };
  mocks.failInsert = false;
  mocks.lock = Promise.resolve();
  mocks.unlink.mockImplementation(async (_tx, tenantId: string, clientId: string) =>
    clientId === "client-2" ? ["trip-1", "trip-2"] : ["trip-1"]);
  mocks.deleteClerk.mockResolvedValue(undefined);
  mocks.broadcast.mockResolvedValue(undefined);
  mocks.calendar.mockResolvedValue(undefined);
});

describe("durable client account deletion", () => {
  it("records the tombstone and unlinks every linked client before calling Clerk", async () => {
    const prepared = await prepareAccountDeletion("clerk-1");
    expect(prepared?.tripIds.sort()).toEqual(["tenant-1\0trip-1", "tenant-1\0trip-2", "tenant-2\0trip-1"]);
    expect(mocks.unlink.mock.calls.map(([, tenant, client]) => [tenant, client])).toEqual([
      ["tenant-1", "client-1"], ["tenant-1", "client-2"], ["tenant-2", "client-3"],
    ]);
    expect(mocks.state.clients.every(c => c.userId === null)).toBe(true);
    expect(mocks.state.user).toBeNull();
    expect(mocks.state.ledger?.after.status).toBe("pending");
    expect(mocks.deleteClerk).not.toHaveBeenCalled();
    notifyDeletedClientTrips(prepared!.tripIds);
    await vi.waitFor(() => expect(mocks.broadcast).toHaveBeenCalledTimes(3));
    expect(mocks.broadcast).toHaveBeenCalledWith("trip-1", "tenant-2");
  });

  it("rolls back local changes on DB failure and never calls Clerk", async () => {
    mocks.failInsert = true;
    await expect(prepareAccountDeletion("clerk-1")).rejects.toThrow("DB insert failed");
    expect(mocks.state.user?.id).toBe("user-1");
    expect(mocks.state.clients.every(c => c.userId === "user-1")).toBe(true);
    expect(mocks.state.ledger).toBeNull();
    expect(mocks.deleteClerk).not.toHaveBeenCalled();
  });

  it("retains pending state after Clerk failure and recovers without authentication", async () => {
    const prepared = await prepareAccountDeletion("clerk-1");
    mocks.deleteClerk.mockRejectedValueOnce(new Error("timeout"));
    expect(await processAccountDeletion(prepared!.id, "clerk-1")).toBe("pending");
    expect(mocks.state.ledger?.after.status).toBe("pending");
    expect(await retryPendingAccountDeletions()).toBe(1);
    expect(mocks.state.ledger?.after.status).toBe("done");
    expect(await processAccountDeletion(prepared!.id, "clerk-1")).toBe("done");
    expect(mocks.deleteClerk).toHaveBeenCalledTimes(2);
  });

  it("serializes repeated concurrent requests and treats Clerk 404 as success", async () => {
    const [first, second] = await Promise.all([prepareAccountDeletion("clerk-1"), prepareAccountDeletion("clerk-1")]);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(mocks.unlink).toHaveBeenCalledTimes(3);
    expect((await findAccountDeletion("clerk-1"))?.id).toBe(first!.id);
    mocks.deleteClerk.mockRejectedValueOnce({ status: 404 });
    expect(await processAccountDeletion(first!.id, "clerk-1")).toBe("done");
    expect(await retryPendingAccountDeletions()).toBe(0);
  });

  it("claims the provider call once when two processors race", async () => {
    const prepared = await prepareAccountDeletion("clerk-1");
    let finish!: () => void;
    mocks.deleteClerk.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const first = processAccountDeletion(prepared!.id, "clerk-1");
    await vi.waitFor(() => expect(mocks.deleteClerk).toHaveBeenCalledTimes(1));
    expect(await processAccountDeletion(prepared!.id, "clerk-1")).toBe("pending");
    expect(mocks.deleteClerk).toHaveBeenCalledTimes(1);
    finish();
    expect(await first).toBe("done");
  });
});