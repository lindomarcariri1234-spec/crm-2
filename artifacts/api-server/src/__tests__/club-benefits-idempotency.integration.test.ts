import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { db, clubBenefitsTable, tenantsTable } from "@workspace/db";
import { ROLES } from "@workspace/permissions";

const auth = vi.hoisted(() => ({
  id: "",
  tenantId: "",
  role: "",
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: vi.fn(async () => auth),
  MANAGEMENT_ROLES: [ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER, ROLES.SUPER_ADMIN],
}));

import clubRouter from "../routes/club.js";
import { errorHandler } from "../middlewares/errorHandler.js";

const run = randomUUID().replaceAll("-", "").slice(0, 12);
const tenantId = `club-benefit-race-${run}`;
const idempotencyKey = randomUUID();
const app = express();
app.use(express.json());
app.use("/api", clubRouter);
app.use(errorHandler);

const body = {
  tier: "gold",
  benefitKey: "airport_lounge",
  label: "Acesso ao lounge",
  description: "Apresente o voucher",
  value: "1 acesso",
  sortOrder: 0,
};

beforeAll(async () => {
  if (!process.env["DATABASE_URL"]) {
    throw new Error("DATABASE_URL must be set to run the club benefit idempotency DB integration test");
  }
  auth.id = `club-benefit-admin-${run}`;
  auth.tenantId = tenantId;
  auth.role = ROLES.AGENCY_ADMIN;
  await db.insert(tenantsTable).values({
    id: tenantId,
    name: "Club Benefit Idempotency Test",
    slug: `club-benefit-race-${run}`,
    email: `club-benefit-race-${run}@example.com`,
  });
});

afterAll(async () => {
  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
});

describe("POST /api/club/benefits PostgreSQL idempotency race", () => {
  it("returns the same benefit ID and persists exactly one row for simultaneous requests", async () => {
    const send = () => request(app)
      .post("/api/club/benefits")
      .set("Idempotency-Key", idempotencyKey)
      .send(body);
    const [first, second] = await Promise.all([send(), send()]);

    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(first.body.id).toBeTruthy();
    expect(second.body.id).toBe(first.body.id);

    const persisted = await db.select({ id: clubBenefitsTable.id })
      .from(clubBenefitsTable)
      .where(and(
        eq(clubBenefitsTable.tenantId, tenantId),
        eq(clubBenefitsTable.idempotencyKey, idempotencyKey),
      ));
    expect(persisted).toEqual([{ id: first.body.id }]);
  });
});
