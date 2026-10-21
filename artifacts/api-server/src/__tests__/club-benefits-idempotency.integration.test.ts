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
const concurrentBenefitId = `club-benefit-edit-race-${run}`;
const originalUpdatedAt = new Date("2026-01-01T00:00:00.000Z");
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

describe("PUT /api/club/benefits/:id PostgreSQL version race", () => {
  it("allows only one concurrent edit from the same version and returns the persisted winner", async () => {
    await db.insert(clubBenefitsTable).values({
      id: concurrentBenefitId,
      tenantId,
      tier: body.tier,
      benefitKey: `race-${run}`,
      label: "Original benefit",
      description: "Original description",
      value: "5%",
      sortOrder: 0,
      createdAt: originalUpdatedAt,
      updatedAt: originalUpdatedAt,
    });

    const update = (label: string) => request(app)
      .put(`/api/club/benefits/${concurrentBenefitId}`)
      .send({
        expectedUpdatedAt: originalUpdatedAt.toISOString(),
        label,
      });
    const [first, second] = await Promise.all([
      update("First staff edit"),
      update("Second staff edit"),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const winner = first.status === 200 ? first : second;
    const conflict = first.status === 409 ? first : second;
    expect(winner.body.label).toMatch(/^First staff edit$|^Second staff edit$/);
    expect(winner.body.updatedAt).not.toBe(originalUpdatedAt.toISOString());
    expect(conflict.body).toMatchObject({
      error: "benefit_changed",
      current: { id: concurrentBenefitId, label: winner.body.label },
    });

    const [persisted] = await db.select()
      .from(clubBenefitsTable)
      .where(and(
        eq(clubBenefitsTable.id, concurrentBenefitId),
        eq(clubBenefitsTable.tenantId, tenantId),
      ))
      .limit(1);
    expect(persisted?.label).toBe(winner.body.label);
    expect(persisted?.updatedAt.toISOString()).toBe(winner.body.updatedAt);
  });
});
