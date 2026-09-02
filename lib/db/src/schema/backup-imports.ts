import { pgTable, text, timestamp, json, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { tenantsTable } from "./tenants";

/** Per-entity-type created/duplicate/skipped/error tallies shown in the final import report. */
export interface BackupImportGroupResult {
  created: number;
  duplicate: number;
  skipped: number;
  errors: Array<{ sourceId?: string; label?: string; error: string }>;
}

export interface BackupImportUserMatch {
  sourceId: string;
  email: string | null;
  name: string | null;
}

export interface BackupImportReport {
  agencia: { updated: boolean };
  usuarios: { matched: number; fallbackToImporter: number; fallbackDetails: BackupImportUserMatch[] };
  clientes: BackupImportGroupResult;
  viagens: BackupImportGroupResult;
  reservas: BackupImportGroupResult;
  passageiros: BackupImportGroupResult;
  embarqueLocais: BackupImportGroupResult;
  checkins: BackupImportGroupResult;
  automacoes: BackupImportGroupResult;
  automacaoAcoes: BackupImportGroupResult;
  automacaoLogs: BackupImportGroupResult;
  indicacoes: BackupImportGroupResult;
  lojaProdutos: BackupImportGroupResult;
  lojaCupons: BackupImportGroupResult;
  lojaPedidos: BackupImportGroupResult;
  lojaItensPedido: BackupImportGroupResult;
  pagamentos: BackupImportGroupResult;
  despesas: BackupImportGroupResult;
  convites: BackupImportGroupResult;
  clientesConquistas: BackupImportGroupResult;
  clientesDestinosSonho: BackupImportGroupResult;
  clientesNotificacoes: BackupImportGroupResult;
  fornecedores: BackupImportGroupResult;
  veiculos: BackupImportGroupResult;
  layoutsVeiculo: BackupImportGroupResult;
  hospedagens: BackupImportGroupResult;
  destinos: BackupImportGroupResult;
  viagensMidia: BackupImportGroupResult;
  pipelines: BackupImportGroupResult;
  etapasPipeline: BackupImportGroupResult;
  negociacoes: BackupImportGroupResult;
  fidelidadeProgramas: BackupImportGroupResult;
  fidelidadeMembros: BackupImportGroupResult;
  fidelidadeTransacoes: BackupImportGroupResult;
  financeiroAcertos: BackupImportGroupResult;
  financeiroLancamentos: BackupImportGroupResult;
  calendario: BackupImportGroupResult;
  documentos: BackupImportGroupResult;
  marketingCampanhas: BackupImportGroupResult;
  marketingEnvios: BackupImportGroupResult;
  marketingNps: BackupImportGroupResult;
  outboundMessages: BackupImportGroupResult;
  outboundDeliveries: BackupImportGroupResult;
  outboundDeliveryAttempts: BackupImportGroupResult;
  distribuicaoOfertas: BackupImportGroupResult;
  distribuicaoOperacoes: BackupImportGroupResult;
  distribuicaoReservas: BackupImportGroupResult;
  comunicacaoEventos: BackupImportGroupResult;
  comunicacaoEntregas: BackupImportGroupResult;
  comunicacaoTentativas: BackupImportGroupResult;
  /**
   * Export section keys (dot-path, matching the export's own JSON structure)
   * that this importer intentionally does not restore — logs, legacy/
   * duplicate data, or references too ambiguous to remap safely — so an
   * admin can't mistake a completed import for a complete restore.
   */
  naoRestaurado: string[];
}

/**
 * One row per whole-request replay, mirroring `tripImportBatchesTable`: lets
 * a browser retry of the exact same import request return the same stored
 * report instead of reprocessing (or erroring on now-consumed unique codes).
 */
export const backupImportBatchesTable = pgTable("backup_import_batches", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  status: text("status").notNull().default("completed"),
  report: json("report").$type<BackupImportReport>().notNull(),
  createdById: text("created_by_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("backup_import_batches_tenant_key_unique").on(table.tenantId, table.idempotencyKey),
]);

export const backupImportBatchesRelations = relations(backupImportBatchesTable, ({ one }) => ({
  tenant: one(tenantsTable, { fields: [backupImportBatchesTable.tenantId], references: [tenantsTable.id] }),
}));

export type BackupImportBatch = typeof backupImportBatchesTable.$inferSelect;

/**
 * Row-level dedup ledger, independent of the batch idempotency key above: for
 * every backup row ever imported for a tenant, remembers which entity type +
 * original (`source`) id from the JSON file maps to which freshly-created
 * (`target`) row id. Re-importing the same file — or a different file that
 * shares previously-imported rows, even under a new idempotency key — looks
 * each row up here first and skips recreating it, while still reusing the
 * mapping to remap foreign keys on rows imported in this later run.
 */
export const backupImportRecordsTable = pgTable("backup_import_records", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  sourceId: text("source_id").notNull(),
  targetId: text("target_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("backup_import_records_tenant_entity_source_unique").on(table.tenantId, table.entityType, table.sourceId),
]);

export const backupImportRecordsRelations = relations(backupImportRecordsTable, ({ one }) => ({
  tenant: one(tenantsTable, { fields: [backupImportRecordsTable.tenantId], references: [tenantsTable.id] }),
}));

export type BackupImportRecord = typeof backupImportRecordsTable.$inferSelect;
