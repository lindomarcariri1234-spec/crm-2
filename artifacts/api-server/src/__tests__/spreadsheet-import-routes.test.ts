import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => {
  const tables = {
    clientsTable: { id: "clients.id", tenantId: "clients.tenantId", cpf: "clients.cpf" },
    tripsTable: { id: "trips.id", tenantId: "trips.tenantId", importFingerprint: "trips.importFingerprint" },
    reservationsTable: { id: "reservations.id", tenantId: "reservations.tenantId", clientId: "reservations.clientId", tripId: "reservations.tripId", status: "reservations.status" },
    paymentsTable: { id: "payments.id", tenantId: "payments.tenantId" },
    expensesTable: { id: "expenses.id", tenantId: "expenses.tenantId" },
    referralsTable: { id: "referrals.id", tenantId: "referrals.tenantId" },
    commissionsTable: { id: "commissions.id", tenantId: "commissions.tenantId" },
    usersTable: { id: "users.id", tenantId: "users.tenantId", email: "users.email" },
    pipelinesTable: { id: "pipelines.id", tenantId: "pipelines.tenantId" },
    pipelineStagesTable: { id: "pipelineStages.id", tenantId: "pipelineStages.tenantId", pipelineId: "pipelineStages.pipelineId" },
    dealsTable: { id: "deals.id", tenantId: "deals.tenantId" },
    tenantsTable: { id: "tenants.id" },
    plansTable: { id: "plans.id", slug: "plans.slug" },
    spreadsheetImportBatchesTable: { tenantId: "batches.tenantId", entity: "batches.entity", idempotencyKey: "batches.key", fileHash: "batches.hash" },
    spreadsheetImportRecordsTable: { tenantId: "records.tenantId", entity: "records.entity", sourceKey: "records.sourceKey" },
  };
  return {
    ...tables,
    queryQueue: [] as unknown[][],
    mockRequireAuth: vi.fn(),
    mockTransaction: vi.fn(),
    mockInsert: vi.fn(),
    mockExecute: vi.fn(),
  };
});

function query(rows: unknown[]) {
  const chain = Object.assign(Promise.resolve(rows), {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn().mockResolvedValue(rows),
  });
  return chain;
}

const tx = {
  execute: mocks.mockExecute,
  select: vi.fn(() => query(mocks.queryQueue.shift() ?? [])),
  insert: mocks.mockInsert,
  transaction: vi.fn(),
};

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => query(mocks.queryQueue.shift() ?? [])),
    transaction: mocks.mockTransaction,
  },
  clientsTable: mocks.clientsTable,
  tripsTable: mocks.tripsTable,
  reservationsTable: mocks.reservationsTable,
  paymentsTable: mocks.paymentsTable,
  expensesTable: mocks.expensesTable,
  referralsTable: mocks.referralsTable,
  commissionsTable: mocks.commissionsTable,
  usersTable: mocks.usersTable,
  pipelinesTable: mocks.pipelinesTable,
  pipelineStagesTable: mocks.pipelineStagesTable,
  dealsTable: mocks.dealsTable,
  tenantsTable: mocks.tenantsTable,
  plansTable: mocks.plansTable,
  spreadsheetImportBatchesTable: mocks.spreadsheetImportBatchesTable,
  spreadsheetImportRecordsTable: mocks.spreadsheetImportRecordsTable,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  count: vi.fn(() => "count"),
  eq: vi.fn((...args: unknown[]) => args),
  or: vi.fn((...args: unknown[]) => args),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ text: strings.join("?"), values }),
}));

vi.mock("../lib/tenant.js", () => ({
  ADMIN_ROLES: ["admin"],
  requireAuth: mocks.mockRequireAuth,
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "generated-id"),
  generateVoucherCode: vi.fn(() => "VOUCHER1"),
}));

vi.mock("../lib/reservation-number.js", () => ({
  getTenantReservationPrefix: vi.fn().mockResolvedValue("AGE"),
  getYearMonth: vi.fn(() => "202608"),
  nextReservationSequence: vi.fn().mockResolvedValue(1),
  buildReservationNumber: vi.fn(() => "AGE-RES-202608-00001"),
  tripTypeToCode: vi.fn(() => "RES"),
}));

import spreadsheetImportsRouter from "../routes/spreadsheet-imports.js";
import { errorHandler } from "../middlewares/errorHandler.js";

function app() {
  const instance = express();
  instance.use(express.json({ limit: "8mb" }));
  instance.use("/api", spreadsheetImportsRouter);
  instance.use(errorHandler);
  return instance;
}

function payload(
  entity: "clients" | "reservations" | "payments" | "expenses" | "referrals" | "commissions" | "deals",
  csv: string,
  idempotencyKey?: string,
) {
  return {
    entity,
    filename: `${entity}.csv`,
    contentBase64: Buffer.from(csv).toString("base64"),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queryQueue.length = 0;
  mocks.mockRequireAuth.mockResolvedValue({ id: "user-a", tenantId: "tenant-a", role: "admin" });
  mocks.mockTransaction.mockImplementation(async callback => callback(tx));
  mocks.mockExecute.mockResolvedValue({ rows: [{ id: "tenant-a" }] });
});

describe("rotas de importação operacional", () => {
  it("faz a prévia sem gravar e classifica uma linha válida", async () => {
    mocks.queryQueue.push([], [], [], [{ status: "active", planId: "plan-a" }], [{ maxClients: 500 }], [{ value: 0 }]);
    const response = await request(app()).post("/api/spreadsheet-imports/preview").send(payload(
      "clients",
      "id_externo,nome,whatsapp,cpf\nCLI-1,Maria,(88) 99999-9999,529.982.247-25",
    ));
    expect(response.status).toBe(200);
    expect(response.body.report.results).toEqual([
      expect.objectContaining({ line: 2, sourceKey: "CLI-1", action: "created" }),
    ]);
    expect(mocks.mockInsert).not.toHaveBeenCalled();
    expect(mocks.mockTransaction).not.toHaveBeenCalled();
  });

  it("rejeita reserva quando cliente ou viagem não podem ser associados", async () => {
    mocks.queryQueue.push([], [], [], []);
    const response = await request(app()).post("/api/spreadsheet-imports/preview").send(payload(
      "reservations",
      "id_externo,cliente_id_externo,viagem_id_externo,status,valor_total,assentos\nRES-1,CLI-X,VIA-X,pending,\"1.000,00\",1",
    ));
    expect(response.status).toBe(200);
    expect(response.body.report.results[0]).toEqual(expect.objectContaining({
      action: "rejected",
      reason: expect.stringContaining("Cliente e viagem não foram encontrados"),
    }));
  });

  it("rejeita pagamento com referência quebrada e status financeiro incompatível", async () => {
    mocks.queryQueue.push([], []);
    const missingReference = await request(app()).post("/api/spreadsheet-imports/preview").send(payload(
      "payments",
      [
        "id_externo,reserva_id_externo,tipo,categoria,valor,status,forma_pagamento,vencimento,pago_em",
        "PAG-1,RES-X,receivable,reserva,\"500,00\",paid,pix,15/12/2026,10/12/2026",
      ].join("\n"),
    ));
    expect(missingReference.status).toBe(200);
    expect(missingReference.body.report.results[0]).toEqual(expect.objectContaining({
      action: "rejected",
      reason: expect.stringContaining("Importe reservas antes de pagamentos"),
    }));

    mocks.queryQueue.push([], []);
    const missingPaidAt = await request(app()).post("/api/spreadsheet-imports/preview").send(payload(
      "payments",
      [
        "id_externo,cliente_id_externo,tipo,categoria,valor,status,forma_pagamento,vencimento",
        "PAG-2,CLI-1,receivable,reserva,\"500,00\",paid,pix,15/12/2026",
      ].join("\n"),
    ));
    expect(missingPaidAt.body.report.results[0]).toEqual(expect.objectContaining({
      action: "rejected",
      reason: expect.stringContaining("Pago em é obrigatório"),
    }));
  });

  it("bloqueia comissão quando o vendedor não existe na agência", async () => {
    mocks.queryQueue.push(
      [],
      [{ entity: "reservations", sourceKey: "RES-1", targetId: "reservation-a" }],
      [{ id: "reservation-a", clientId: "client-a", tripId: "trip-a" }],
      [],
    );
    const response = await request(app()).post("/api/spreadsheet-imports/preview").send(payload(
      "commissions",
      [
        "id_externo,vendedor_email,reserva_id_externo,valor_base,valor_comissao,status",
        "COM-1,ausente@agencia.com,RES-1,\"1.000,00\",\"100,00\",approved",
      ].join("\n"),
    ));
    expect(response.status).toBe(200);
    expect(response.body.report.results[0]).toEqual(expect.objectContaining({
      action: "rejected",
      reason: expect.stringContaining("Usuários ausentes não são recriados"),
    }));
  });

  it("exige que etapa e pipeline explícitos pertençam um ao outro", async () => {
    mocks.queryQueue.push(
      [],
      [],
      [],
      [],
      [],
      [{ id: "owner-a", email: "owner@agencia.com" }],
      [{ id: "stage-a", pipelineId: "pipeline-b" }],
      [{ id: "pipeline-a" }],
    );
    const response = await request(app()).post("/api/spreadsheet-imports/preview").send(payload(
      "deals",
      [
        "id_externo,pipeline_id,etapa_id,responsavel_email,titulo,valor,status,nome_lead",
        "NEG-1,pipeline-a,stage-a,owner@agencia.com,Lead teste,\"1.000,00\",open,Lead sem cadastro",
      ].join("\n"),
    ));
    expect(response.status).toBe(200);
    expect(response.body.report.results[0]).toEqual(expect.objectContaining({
      action: "rejected",
      reason: expect.stringContaining("Etapa não pertence ao pipeline"),
    }));
  });

  it("rejeita a segunda reserva ativa do mesmo cliente e viagem no arquivo", async () => {
    mocks.queryQueue.push(
      [],
      [
        { entity: "clients", sourceKey: "CLI-1", targetId: "client-a" },
        { entity: "trips", sourceKey: "VIA-1", targetId: "trip-a" },
      ],
      [{ id: "trip-a", totalCapacity: 20, importFingerprint: null }],
      [],
    );
    const response = await request(app()).post("/api/spreadsheet-imports/preview").send(payload(
      "reservations",
      [
        "id_externo,cliente_id_externo,viagem_id_externo,status,valor_total,assentos",
        "RES-1,CLI-1,VIA-1,pending,\"1.000,00\",1",
        "RES-2,CLI-1,VIA-1,confirmed,\"1.000,00\",2",
      ].join("\n"),
    ));
    expect(response.status).toBe(200);
    expect(response.body.report.results[0].action).toBe("created");
    expect(response.body.report.results[1]).toEqual(expect.objectContaining({
      action: "rejected",
      reason: expect.stringContaining("já possui uma reserva ativa"),
    }));
  });

  it("rejeita UF inexistente e reserva ativa sem assentos", async () => {
    mocks.queryQueue.push([], [], [], [{ status: "active", planId: "plan-a" }], [{ maxClients: 500 }], [{ value: 0 }]);
    const clientResponse = await request(app()).post("/api/spreadsheet-imports/preview").send(payload(
      "clients",
      "id_externo,nome,whatsapp,cpf,estado\nCLI-1,Maria,(88) 99999-9999,529.982.247-25,XX",
    ));
    expect(clientResponse.body.report.results[0]).toEqual(expect.objectContaining({
      action: "rejected",
      reason: expect.stringContaining("UF brasileira válida"),
    }));

    mocks.queryQueue.push([], [], [], []);
    const reservationResponse = await request(app()).post("/api/spreadsheet-imports/preview").send(payload(
      "reservations",
      "id_externo,cliente_id_externo,viagem_id_externo,status,valor_total\nRES-1,CLI-1,VIA-1,pending,\"100,00\"",
    ));
    expect(reservationResponse.body.report.results[0]).toEqual(expect.objectContaining({
      action: "rejected",
      reason: expect.stringContaining("Assentos é obrigatório"),
    }));
  });

  it("repete o relatório salvo para a mesma chave e não grava novamente", async () => {
    const savedReport = {
      entity: "clients",
      contractVersion: 1,
      filename: "clients.csv",
      totalRows: 1,
      results: [{ line: 2, sourceKey: "CLI-1", action: "created", targetId: "client-a" }],
    };
    mocks.queryQueue.push([{ id: "batch-a", fileHash: expect.anything(), report: savedReport }]);
    const csv = "id_externo,nome,whatsapp,cpf\nCLI-1,Maria,(88) 99999-9999,529.982.247-25";
    const body = payload("clients", csv, "same-key");
    const hash = await import("node:crypto").then(({ createHash }) => createHash("sha256").update(Buffer.from(csv)).digest("hex"));
    mocks.queryQueue[0] = [{ id: "batch-a", fileHash: hash, report: savedReport }];
    const response = await request(app()).post("/api/spreadsheet-imports/import").send(body);
    expect(response.status).toBe(200);
    expect(response.body.replayed).toBe(true);
    expect(response.body.report).toEqual(savedReport);
    expect(mocks.mockInsert).not.toHaveBeenCalled();
  });

  it("nega a prévia para quem não é administrador", async () => {
    mocks.mockRequireAuth.mockResolvedValue({ id: "seller-a", tenantId: "tenant-a", role: "sales" });
    const response = await request(app()).post("/api/spreadsheet-imports/preview").send(payload(
      "clients",
      "id_externo,nome,whatsapp,cpf\nCLI-1,Maria,(88) 99999-9999,529.982.247-25",
    ));
    expect(response.status).toBe(403);
    expect(mocks.queryQueue).toHaveLength(0);
  });
});