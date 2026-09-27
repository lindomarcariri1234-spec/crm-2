import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientsTable, clientDreamDestinationsTable, db, pool, tenantsTable, usersTable } from "@workspace/db";
import { and, count, eq, inArray } from "drizzle-orm";
import { generateId } from "../lib/id";
import { insertDreamDestination } from "../lib/client-dream-destinations";

const tenantA = `test-dream-a-${generateId()}`;
const tenantB = `test-dream-b-${generateId()}`;
const userA = `test-dream-user-a-${generateId()}`;
const userB = `test-dream-user-b-${generateId()}`;
const clientA = `test-dream-client-a-${generateId()}`;
const clientB = `test-dream-client-b-${generateId()}`;

const destination = (tenantId: string, clientId: string) => ({
  id: generateId(), tenantId, clientId, destinationName: "Bonito", note: null,
});

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("Integration test requires a disposable migrated PostgreSQL database");
  await db.insert(tenantsTable).values([
    { id: tenantA, name: "Dream A", slug: tenantA, email: `${tenantA}@example.com` },
    { id: tenantB, name: "Dream B", slug: tenantB, email: `${tenantB}@example.com` },
  ]);
  await db.insert(usersTable).values([
    { id: userA, clerkId: userA, tenantId: tenantA, name: "Agent A", email: `${userA}@example.com`, referralCode: userA },
    { id: userB, clerkId: userB, tenantId: tenantB, name: "Agent B", email: `${userB}@example.com`, referralCode: userB },
  ]);
  await db.insert(clientsTable).values([
    { id: clientA, tenantId: tenantA, name: "Client A", email: `${clientA}@example.com`, whatsapp: "11999990001", createdById: userA },
    { id: clientB, tenantId: tenantB, name: "Client B", email: `${clientB}@example.com`, whatsapp: "11999990002", createdById: userB },
  ]);
});

afterAll(async () => {
  await db.delete(tenantsTable).where(inArray(tenantsTable.id, [tenantA, tenantB]));
  await pool.end();
});

describe("atomic per-client dream destination limit (real DB)", () => {
  it("isolates clients and tenants and serializes concurrent inserts at the limit", async () => {
    await db.insert(clientDreamDestinationsTable).values(
      Array.from({ length: 29 }, () => destination(tenantA, clientA)),
    );
    await expect(insertDreamDestination(destination(tenantA, clientB))).rejects.toMatchObject({ code: "CLIENT_NOT_FOUND" });
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () => insertDreamDestination(destination(tenantA, clientA))),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((a) => a.status === "rejected")).toHaveLength(7);
    const [total] = await db.select({ c: count() }).from(clientDreamDestinationsTable)
      .where(and(eq(clientDreamDestinationsTable.tenantId, tenantA), eq(clientDreamDestinationsTable.clientId, clientA)));
    expect(Number(total.c)).toBe(30);
    await expect(insertDreamDestination(destination(tenantB, clientB))).resolves.toBeInstanceOf(Date);
  });
});