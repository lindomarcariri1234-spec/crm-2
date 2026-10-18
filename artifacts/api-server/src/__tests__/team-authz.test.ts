import { ROLES } from "@workspace/permissions";
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const {
  mockSelect,
  mockFrom,
  mockWhere,
  mockLimit,
  mockInsert,
  mockInsertValues,
  mockDelete,
  mockDeleteWhere,
  mockUpdate,
  mockUpdateSet,
  mockUpdateWhere,
  mockRequireAuth,
  mockCreateInvitation,
  mockRevokeInvitation,
  mockGenerateId,
  tables,
} = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockWhere = vi.fn();
  const mockFrom = vi.fn();
  const mockSelect = vi.fn();
  const mockInsertValues = vi.fn();
  const mockInsert = vi.fn();
  const mockDeleteWhere = vi.fn();
  const mockDelete = vi.fn();
  const mockUpdateWhere = vi.fn();
  const mockUpdateSet = vi.fn();
  const mockUpdate = vi.fn();

  const tables = {
    users: {
      __name: "users",
      id: "id",
      tenantId: "tenantId",
      role: "role",
      email: "email",
    },
    invites: {
      __name: "invites",
      id: "id",
      tenantId: "tenantId",
      email: "email",
      accepted: "accepted",
      expiresAt: "expiresAt",
      role: "role",
    },
  };

  return {
    mockSelect,
    mockFrom,
    mockWhere,
    mockLimit,
    mockInsert,
    mockInsertValues,
    mockDelete,
    mockDeleteWhere,
    mockUpdate,
    mockUpdateSet,
    mockUpdateWhere,
    mockRequireAuth: vi.fn(),
    mockCreateInvitation: vi.fn(),
    mockRevokeInvitation: vi.fn(),
    mockGenerateId: vi.fn(() => "generated-id"),
    tables,
  };
});

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    delete: mockDelete,
    update: mockUpdate,
  },
  usersTable: tables.users,
  invitesTable: tables.invites,
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: string, value: unknown) => ({ op: "eq", column, value }),
  and: (...conditions: unknown[]) => ({ op: "and", conditions }),
  gt: (column: string, value: unknown) => ({ op: "gt", column, value }),
}));

vi.mock("@clerk/express", () => ({
  clerkClient: {
    invitations: {
      createInvitation: mockCreateInvitation,
      revokeInvitation: mockRevokeInvitation,
    },
  },
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: mockRequireAuth,
  ADMIN_ROLES: [ROLES.SUPER_ADMIN, ROLES.AGENCY_ADMIN],
  ALL_STAFF_ROLES: [
    ROLES.SUPER_ADMIN,
    ROLES.AGENCY_ADMIN,
    ROLES.AGENCY_MANAGER,
    ROLES.SALES,
    ROLES.SUPPORT,
  ],
}));

vi.mock("../lib/id.js", () => ({ generateId: mockGenerateId }));

import teamRouter from "../routes/team.js";
import { errorHandler } from "../middlewares/errorHandler.js";

type Row = Record<string, unknown>;
type Condition =
  | { op: "eq"; column: string; value: unknown }
  | { op: "gt"; column: string; value: unknown }
  | { op: "and"; conditions: Condition[] };

const fixtureRows: { users: Row[]; invites: Row[] } = { users: [], invites: [] };
let selectedTable: { __name: string } | undefined;
let selectedCondition: Condition | undefined;

function matches(condition: Condition | undefined, row: Row): boolean {
  if (!condition) return true;
  if (condition.op === "and") {
    return condition.conditions.every((part) => matches(part, row));
  }
  if (condition.op === "eq") return row[condition.column] === condition.value;
  const value = row[condition.column];
  return value instanceof Date && value > (condition.value as Date);
}

function rowsFor(table: { __name: string } | undefined): Row[] {
  if (table?.__name === "users") return fixtureRows.users;
  if (table?.__name === "invites") return fixtureRows.invites;
  return [];
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: express.Request & { log?: Record<string, unknown> }, _res, next) => {
    const noop = () => {};
    req.log = { trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop } as never;
    next();
  });
  app.use("/api", teamRouter);
  app.use(errorHandler);
  return app;
}

function authAs(role: string, tenantId = "tenant-a") {
  mockRequireAuth.mockResolvedValue({
    id: "admin-a",
    clerkId: "clerk-admin-a",
    tenantId,
    role,
    name: "Admin A",
    email: "admin-a@example.com",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fixtureRows.users = [
    {
      id: "member-a",
      tenantId: "tenant-a",
      role: ROLES.SALES,
      clerkId: "clerk-member-a",
      name: "Seller A",
      email: "seller-a@example.com",
      isActive: true,
      avatarUrl: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    {
      id: "member-b",
      tenantId: "tenant-b",
      role: ROLES.SALES,
      clerkId: "clerk-member-b",
      name: "Seller B",
      email: "seller-b@example.com",
      isActive: true,
      avatarUrl: null,
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    },
  ];
  fixtureRows.invites = [
    {
      id: "invite-a",
      tenantId: "tenant-a",
      email: "invite-a@example.com",
      role: ROLES.SALES,
      accepted: false,
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      token: "clerk-invite-a",
    },
    {
      id: "invite-b",
      tenantId: "tenant-b",
      email: "invite-b@example.com",
      role: ROLES.SALES,
      accepted: false,
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
      token: "clerk-invite-b",
    },
  ];
  selectedTable = undefined;
  selectedCondition = undefined;

  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockImplementation((table: { __name: string }) => {
    selectedTable = table;
    return { where: mockWhere, limit: mockLimit };
  });
  mockWhere.mockImplementation((condition: Condition) => {
    selectedCondition = condition;
    const query = {
      limit: mockLimit,
      then: (
        resolve: (value: Row[]) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(
        rowsFor(selectedTable).filter((row) => matches(condition, row)),
      ).then(resolve, reject),
    };
    return query;
  });
  mockLimit.mockImplementation((count?: number) =>
    Promise.resolve(
      rowsFor(selectedTable)
        .filter((row) => matches(selectedCondition, row))
        .slice(0, count ?? rowsFor(selectedTable).length),
    ),
  );
  mockInsert.mockReturnValue({ values: mockInsertValues });
  mockInsertValues.mockResolvedValue([]);
  mockDelete.mockReturnValue({ where: mockDeleteWhere });
  mockDeleteWhere.mockResolvedValue([]);
  mockUpdate.mockReturnValue({ set: mockUpdateSet });
  mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
  mockUpdateWhere.mockImplementation((condition: Condition) => {
    const affected = fixtureRows.users.filter((row) => matches(condition, row));
    for (const row of affected) row.isActive = false;
    return Promise.resolve(affected);
  });
  mockCreateInvitation.mockResolvedValue({ id: "clerk-invite-new" });
  mockRevokeInvitation.mockResolvedValue({});
  authAs(ROLES.AGENCY_ADMIN);
});

describe("team administration tenant and role boundaries", () => {
  it("lists only members belonging to the caller's tenant", async () => {
    const res = await request(buildApp()).get("/api/team/members");

    expect(res.status).toBe(200);
    expect(res.body.map((member: { id: string }) => member.id)).toEqual(["member-a"]);
  });

  it("lists only invites belonging to the caller's tenant", async () => {
    const res = await request(buildApp()).get("/api/team/invites");

    expect(res.status).toBe(200);
    expect(res.body.map((invite: { id: string }) => invite.id)).toEqual(["invite-a"]);
  });

  it("does not cancel an invite owned by another tenant", async () => {
    const res = await request(buildApp()).delete("/api/team/invites/invite-b");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockDelete).not.toHaveBeenCalled();
    expect(fixtureRows.invites.find((invite) => invite.id === "invite-b")).toBeTruthy();
  });

  it("does not deactivate a team member owned by another tenant", async () => {
    const res = await request(buildApp()).delete("/api/team/members/member-b");

    expect(res.status).toBe(200);
    expect(fixtureRows.users.find((user) => user.id === "member-b")?.isActive).toBe(true);
    expect(fixtureRows.users.find((user) => user.id === "member-a")?.isActive).toBe(true);
  });

  it("rejects team invitation attempts by a manager", async () => {
    authAs(ROLES.AGENCY_MANAGER);

    const res = await request(buildApp())
      .post("/api/team/invite")
      .send({ email: "new-seller@example.com", role: ROLES.SALES });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN_ROLE");
    expect(mockCreateInvitation).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("only creates seller invitations and binds them to the caller's tenant", async () => {
    const res = await request(buildApp())
      .post("/api/team/invite")
      .send({ email: "new-seller@example.com", role: ROLES.SALES });

    expect(res.status).toBe(201);
    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-a",
      email: "new-seller@example.com",
      role: ROLES.SALES,
    }));
    expect(mockCreateInvitation).toHaveBeenCalledWith(expect.objectContaining({
      publicMetadata: expect.objectContaining({
        tenantId: "tenant-a",
        role: ROLES.SALES,
      }),
    }));
  });

  it("rejects attempts to invite an elevated role", async () => {
    const res = await request(buildApp())
      .post("/api/team/invite")
      .send({ email: "new-admin@example.com", role: ROLES.AGENCY_ADMIN });

    expect(res.status).toBe(400);
    expect(mockCreateInvitation).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
