import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { mockListFiles, mockDeleteFiles, mockSendReminderHtmlEmail } = vi.hoisted(() => ({
  mockListFiles: vi.fn(),
  mockDeleteFiles: vi.fn(),
  mockSendReminderHtmlEmail: vi.fn(),
}));

// Keep database reference collection real while avoiding all provider network calls.
vi.mock("../lib/uploadthing.js", () => ({
  utapi: {
    listFiles: mockListFiles,
    deleteFiles: mockDeleteFiles,
  },
  extractVerifiedUploadThingKey: (url: string): string | null => {
    try {
      const parsedUrl = new URL(url);
      if (
        parsedUrl.hostname !== "utfs.io" ||
        !parsedUrl.pathname.startsWith("/f/")
      ) {
        return null;
      }
      return parsedUrl.pathname.slice("/f/".length).split("/")[0] || null;
    } catch {
      return null;
    }
  },
}));

vi.mock("@workspace/email", () => ({
  sendReminderHtmlEmail: mockSendReminderHtmlEmail,
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  chatbotConversationsTable,
  chatbotMessagesTable,
  db,
  platformSettingsTable,
  pool,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { collectReferencedUploadThingKeys } from "../lib/collectReferencedUploadThingKeys.js";
import { runUploadThingOrphanCleanup } from "../lib/uploadthing-orphan-cleanup.js";
import { runWhatsAppInboundMediaRetentionCleanup } from "../lib/whatsapp-media-retention.js";

const LOCAL_TEST_DATABASE = "visitecrm_whatsapp_media_retention_test";
const CI_TEST_DATABASE = "visitecrm_ci";
const STAGING_KEY = "uploadthing_orphan_candidates";
const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 90 * DAY_MS;
const ORPHAN_GRACE_MS = 26 * 60 * 60 * 1000;
const RUN_ID = generateId();
const NOW = new Date();

const tenantA = `wa-retention-tenant-a-${RUN_ID}`;
const tenantB = `wa-retention-tenant-b-${RUN_ID}`;
const whatsappConversationA = `wa-retention-whatsapp-a-${RUN_ID}`;
const webchatConversationA = `wa-retention-webchat-a-${RUN_ID}`;
const whatsappConversationB = `wa-retention-whatsapp-b-${RUN_ID}`;

const messageIds = {
  expiredInbound: `wa-retention-expired-${RUN_ID}`,
  recentSharedInbound: `wa-retention-recent-${RUN_ID}`,
  exactBoundaryInbound: `wa-retention-boundary-${RUN_ID}`,
  oldOutbound: `wa-retention-outbound-${RUN_ID}`,
  oldWebchatInbound: `wa-retention-webchat-${RUN_ID}`,
  mismatchedTenantInbound: `wa-retention-mismatched-tenant-${RUN_ID}`,
  failedRetentionInbound: `wa-retention-failed-cleanup-${RUN_ID}`,
  lateReferenceInbound: `wa-retention-late-reference-message-${RUN_ID}`,
};
const partialBatchMessageIds: string[] = [];
const PARTIAL_FAILURE_MARKER = "partial-retention-failure-marker";
const FAILURE_STATE_KEY = "whatsapp_media_retention_failure_state";

const sharedFileKey = `wa-retention-shared-${RUN_ID}`;
const failedRetentionFileKey = `wa-retention-failed-file-${RUN_ID}`;
const boundaryFileKey = `wa-retention-boundary-${RUN_ID}`;
const outboundFileKey = `wa-retention-outbound-${RUN_ID}`;
const webchatFileKey = `wa-retention-webchat-${RUN_ID}`;
const mismatchedTenantFileKey = `wa-retention-tenant-mismatch-${RUN_ID}`;
const sharedFileUrl = `https://utfs.io/f/${sharedFileKey}`;

let isolatedDatabaseVerified = false;
let previousStagingRow:
  | {
      id: string;
      key: string;
      value: string | null;
      label: string;
      description: string | null;
      type: string;
      updatedAt: Date;
    }
  | undefined;
let previousRetentionFailureRow:
  | {
      id: string;
      key: string;
      value: string | null;
      label: string;
      description: string | null;
      type: string;
      updatedAt: Date;
    }
  | undefined;

function isLoopback(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "::1"].includes(
    hostname.replace(/^\[|\]$/g, "").toLowerCase(),
  );
}

async function assertIsolatedDatabase(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL must point to an isolated WhatsApp media retention test database",
    );
  }

  let configuredUrl: URL;
  try {
    configuredUrl = new URL(databaseUrl);
  } catch {
    throw new Error(
      "Refusing to run WhatsApp media retention integration test with an invalid database URL",
    );
  }

  const configuredDatabase = decodeURIComponent(
    configuredUrl.pathname.replace(/^\/+/, ""),
  );
  const configuredHost = configuredUrl.hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  const isDedicatedLocalDatabase =
    configuredDatabase === LOCAL_TEST_DATABASE && isLoopback(configuredHost);
  const isCiDatabase =
    process.env.CI === "true" &&
    configuredDatabase === CI_TEST_DATABASE &&
    isLoopback(configuredHost);
  if (!isDedicatedLocalDatabase && !isCiDatabase) {
    throw new Error(
      "Refusing to run WhatsApp media retention integration test outside an isolated database",
    );
  }

  const { rows } = await pool.query<{
    database_name: string;
    server_address: string | null;
  }>(`
    SELECT
      current_database() AS database_name,
      host(inet_server_addr()) AS server_address
  `);
  const database = rows[0];
  const connectedToLocalTestDatabase =
    isDedicatedLocalDatabase &&
    database?.database_name === LOCAL_TEST_DATABASE &&
    isLoopback(database.server_address ?? "");
  const connectedToCiTestDatabase =
    isCiDatabase && database?.database_name === CI_TEST_DATABASE;
  if (!connectedToLocalTestDatabase && !connectedToCiTestDatabase) {
    throw new Error(
      "Refusing to run WhatsApp media retention integration test outside an isolated database",
    );
  }
}

beforeAll(async () => {
  await assertIsolatedDatabase();
  isolatedDatabaseVerified = true;

  const [existingStagingRow] = await db
    .select({
      id: platformSettingsTable.id,
      key: platformSettingsTable.key,
      value: platformSettingsTable.value,
      label: platformSettingsTable.label,
      description: platformSettingsTable.description,
      type: platformSettingsTable.type,
      updatedAt: platformSettingsTable.updatedAt,
    })
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, STAGING_KEY))
    .limit(1);
  previousStagingRow = existingStagingRow;
  const [existingRetentionFailureRow] = await db
    .select({
      id: platformSettingsTable.id,
      key: platformSettingsTable.key,
      value: platformSettingsTable.value,
      label: platformSettingsTable.label,
      description: platformSettingsTable.description,
      type: platformSettingsTable.type,
      updatedAt: platformSettingsTable.updatedAt,
    })
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, FAILURE_STATE_KEY))
    .limit(1);
  previousRetentionFailureRow = existingRetentionFailureRow;

  const staleAt = new Date(NOW.getTime() - RETENTION_MS - DAY_MS);
  const recentAt = new Date(NOW.getTime() - RETENTION_MS + DAY_MS);
  const boundaryAt = new Date(NOW.getTime() - RETENTION_MS);
  await db.transaction(async (tx) => {
    await tx.insert(chatbotConversationsTable).values([
      { id: whatsappConversationA, tenantId: tenantA, channel: "whatsapp" },
      { id: webchatConversationA, tenantId: tenantA, channel: "webchat" },
      { id: whatsappConversationB, tenantId: tenantB, channel: "whatsapp" },
    ]);

    await tx.insert(chatbotMessagesTable).values([
      {
        id: messageIds.expiredInbound,
        conversationId: whatsappConversationA,
        tenantId: tenantA,
        role: "user",
        content: "Texto recebido com áudio",
        mediaUrl: sharedFileUrl,
        mediaMimeType: "audio/ogg",
        mediaFileName: "recado.ogg",
        sentAt: staleAt,
      },
      {
        id: messageIds.recentSharedInbound,
        conversationId: whatsappConversationA,
        tenantId: tenantA,
        role: "user",
        content: "Áudio recente que compartilha o mesmo arquivo",
        mediaUrl: sharedFileUrl,
        mediaMimeType: "audio/ogg",
        mediaFileName: "recado.ogg",
        sentAt: recentAt,
      },
      {
        id: messageIds.exactBoundaryInbound,
        conversationId: whatsappConversationA,
        tenantId: tenantA,
        role: "user",
        content: "Mensagem exatamente no limite",
        mediaUrl: `https://utfs.io/f/${boundaryFileKey}`,
        mediaMimeType: "image/jpeg",
        mediaFileName: "limite.jpg",
        sentAt: boundaryAt,
      },
      {
        id: messageIds.oldOutbound,
        conversationId: whatsappConversationA,
        tenantId: tenantA,
        role: "assistant",
        content: "Mídia enviada pela agência",
        mediaUrl: `https://utfs.io/f/${outboundFileKey}`,
        mediaMimeType: "image/jpeg",
        mediaFileName: "enviada.jpg",
        sentAt: staleAt,
      },
      {
        id: messageIds.oldWebchatInbound,
        conversationId: webchatConversationA,
        tenantId: tenantA,
        role: "user",
        content: "Anexo antigo do webchat",
        mediaUrl: `https://utfs.io/f/${webchatFileKey}`,
        mediaMimeType: "image/jpeg",
        mediaFileName: "webchat.jpg",
        sentAt: staleAt,
      },
      {
        id: messageIds.mismatchedTenantInbound,
        conversationId: whatsappConversationB,
        tenantId: tenantA,
        role: "user",
        content: "Registro com tenant incompatível",
        mediaUrl: `https://utfs.io/f/${mismatchedTenantFileKey}`,
        mediaMimeType: "image/jpeg",
        mediaFileName: "tenant.jpg",
        sentAt: staleAt,
      },
    ]);

    const stagedCandidates = JSON.stringify([
      { key: sharedFileKey, stagedAt: Date.now() - 27 * 60 * 60 * 1000 },
    ]);
    if (previousStagingRow) {
      await tx
        .update(platformSettingsTable)
        .set({ value: stagedCandidates })
        .where(eq(platformSettingsTable.key, STAGING_KEY));
    } else {
      await tx.insert(platformSettingsTable).values({
        id: `wa-retention-staging-${RUN_ID}`,
        key: STAGING_KEY,
        value: stagedCandidates,
        label: "WhatsApp retention integration fixture",
        description: "Temporary test staging record",
        type: "json",
      });
    }
  });

  mockListFiles.mockResolvedValue({
    files: [{ key: sharedFileKey, name: "shared.ogg", size: 1234 }],
    hasMore: false,
  });
  mockDeleteFiles.mockRejectedValue(
    new Error("Unexpected provider delete during shared-file retention test"),
  );
  mockSendReminderHtmlEmail.mockReset().mockResolvedValue({ success: true });
}, 30_000);

afterAll(async () => {
  try {
    if (isolatedDatabaseVerified) {
      await db.transaction(async (tx) => {
        await tx
          .delete(chatbotMessagesTable)
          .where(
            inArray(chatbotMessagesTable.id, [
              ...Object.values(messageIds),
              ...partialBatchMessageIds,
            ]),
          );
        await tx
          .delete(chatbotConversationsTable)
          .where(
            inArray(chatbotConversationsTable.id, [
              whatsappConversationA,
              webchatConversationA,
              whatsappConversationB,
            ]),
          );

        if (previousStagingRow) {
          await tx
            .update(platformSettingsTable)
            .set({
              value: previousStagingRow.value,
              label: previousStagingRow.label,
              description: previousStagingRow.description,
              type: previousStagingRow.type,
              updatedAt: previousStagingRow.updatedAt,
            })
            .where(eq(platformSettingsTable.key, STAGING_KEY));
        } else {
          await tx
            .delete(platformSettingsTable)
            .where(eq(platformSettingsTable.key, STAGING_KEY));
        }

        if (previousRetentionFailureRow) {
          await tx
            .update(platformSettingsTable)
            .set({
              value: previousRetentionFailureRow.value,
              label: previousRetentionFailureRow.label,
              description: previousRetentionFailureRow.description,
              type: previousRetentionFailureRow.type,
              updatedAt: previousRetentionFailureRow.updatedAt,
            })
            .where(eq(platformSettingsTable.key, FAILURE_STATE_KEY));
        } else {
          await tx
            .delete(platformSettingsTable)
            .where(eq(platformSettingsTable.key, FAILURE_STATE_KEY));
        }
      });
    }
  } finally {
    await pool.end();
  }
});

describe("WhatsApp media retention with PostgreSQL", () => {
  it("expires only eligible rows and preserves a shared file across concurrent cleanups", async () => {
    const concurrentRetentionResults = await Promise.all([
      runWhatsAppInboundMediaRetentionCleanup(NOW),
      runWhatsAppInboundMediaRetentionCleanup(NOW),
    ]);
    expect(
      concurrentRetentionResults.reduce(
        (total, result) => total + result.expiredMessages,
        0,
      ),
    ).toBe(1);
    expect(
      concurrentRetentionResults.every((result) => result.errors === 0),
    ).toBe(true);

    const messages = await db
      .select()
      .from(chatbotMessagesTable)
      .where(inArray(chatbotMessagesTable.id, Object.values(messageIds)));
    const messageById = new Map(
      messages.map((message) => [message.id, message]),
    );
    const expiredInbound = messageById.get(messageIds.expiredInbound);

    expect(expiredInbound).toMatchObject({
      mediaUrl: null,
      mediaMimeType: "audio/ogg",
      mediaFileName: "recado.ogg",
      content: "Texto recebido com áudio",
      mediaExpiredAt: expect.any(Date),
    });

    for (const preservedId of [
      messageIds.recentSharedInbound,
      messageIds.exactBoundaryInbound,
      messageIds.oldOutbound,
      messageIds.oldWebchatInbound,
      messageIds.mismatchedTenantInbound,
    ]) {
      expect(messageById.get(preservedId)?.mediaUrl).toBeTruthy();
      expect(messageById.get(preservedId)?.mediaExpiredAt).toBeNull();
    }

    const referencedKeys = await collectReferencedUploadThingKeys();
    expect(referencedKeys.has(sharedFileKey)).toBe(true);

    const cleanupResults = await Promise.all([
      runUploadThingOrphanCleanup(),
      runUploadThingOrphanCleanup(),
    ]);
    expect(cleanupResults.every((result) => result.errors === 0)).toBe(true);
    expect(cleanupResults.every((result) => result.newlyStaged === 0)).toBe(
      true,
    );
    expect(cleanupResults.every((result) => result.deleted === 0)).toBe(true);
    expect(mockDeleteFiles).not.toHaveBeenCalled();

    const [stagingRow] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, STAGING_KEY))
      .limit(1);
    expect(JSON.parse(stagingRow?.value ?? "[]")).toEqual([]);
  }, 30_000);

  it("serializes overlapping orphan scans so neither run loses its staged candidates", async () => {
    const firstKey = `wa-retention-overlap-a-${RUN_ID}`;
    const secondKey = `wa-retention-overlap-b-${RUN_ID}`;
    await db
      .update(platformSettingsTable)
      .set({ value: "[]" })
      .where(eq(platformSettingsTable.key, STAGING_KEY));

    let firstScanStarted!: () => void;
    const firstScanStartedPromise = new Promise<void>((resolve) => {
      firstScanStarted = resolve;
    });
    let releaseFirstScan!: () => void;
    const firstScanGate = new Promise<void>((resolve) => {
      releaseFirstScan = resolve;
    });

    mockListFiles.mockReset().mockImplementation(async () => {
      if (mockListFiles.mock.calls.length === 1) {
        firstScanStarted();
        await firstScanGate;
        return {
          files: [{ key: firstKey, name: "overlap-a.jpg", size: 100 }],
          hasMore: false,
        };
      }
      return {
        files: [
          { key: firstKey, name: "overlap-a.jpg", size: 100 },
          { key: secondKey, name: "overlap-b.jpg", size: 100 },
        ],
        hasMore: false,
      };
    });

    const firstRun = runUploadThingOrphanCleanup();
    await firstScanStartedPromise;
    const secondRun = runUploadThingOrphanCleanup();

    let secondRunWaitingForLock = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const { rows } = await pool.query<{ waiting: number }>(`
        SELECT count(*)::int AS waiting
        FROM pg_stat_activity
        WHERE wait_event_type = 'Lock'
          AND query LIKE '%pg_advisory_lock(hashtextextended%'
      `);
      if (rows[0]?.waiting) {
        secondRunWaitingForLock = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(secondRunWaitingForLock).toBe(true);

    releaseFirstScan();
    const results = await Promise.all([firstRun, secondRun]);
    expect(results.every((result) => result.errors === 0)).toBe(true);
    expect(results.reduce((total, result) => total + result.newlyStaged, 0)).toBe(2);

    const [stagingRow] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, STAGING_KEY))
      .limit(1);
    const stagedKeys = (
      JSON.parse(stagingRow?.value ?? "[]") as { key: string; stagedAt: number }[]
    )
      .map(({ key }) => key)
      .sort();
    expect(stagedKeys).toEqual([firstKey, secondKey].sort());
  }, 30_000);

  it("rescues a file that becomes referenced after the initial reference scan", async () => {
    const lateReferenceKey = `wa-retention-late-reference-${RUN_ID}`;
    await db
      .update(platformSettingsTable)
      .set({
        value: JSON.stringify([
          {
            key: lateReferenceKey,
            stagedAt: Date.now() - ORPHAN_GRACE_MS - 1,
          },
        ]),
      })
      .where(eq(platformSettingsTable.key, STAGING_KEY));

    mockListFiles.mockReset().mockImplementation(async () => {
      await db.insert(chatbotMessagesTable).values({
        id: messageIds.lateReferenceInbound,
        conversationId: whatsappConversationA,
        tenantId: tenantA,
        role: "user",
        content: "Referência criada durante a limpeza",
        mediaUrl: `https://utfs.io/f/${lateReferenceKey}`,
        mediaMimeType: "image/jpeg",
        mediaFileName: "referencia.jpg",
        sentAt: NOW,
      });
      return {
        files: [{ key: lateReferenceKey, name: "referencia.jpg", size: 100 }],
        hasMore: false,
      };
    });
    mockDeleteFiles.mockReset();

    const result = await runUploadThingOrphanCleanup();

    expect(result.deleted).toBe(0);
    expect(result.errors).toBe(0);
    expect(mockDeleteFiles).not.toHaveBeenCalled();
    const referencedKeys = await collectReferencedUploadThingKeys();
    expect(referencedKeys.has(lateReferenceKey)).toBe(true);

    const [stagingRow] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, STAGING_KEY))
      .limit(1);
    expect(JSON.parse(stagingRow?.value ?? "[]")).toEqual([]);
  }, 30_000);

  describe("retention cleanup failure recovery", () => {
    it("protects a referenced file after retention fails, then releases it through the grace period", async () => {
      const failedRetentionFileUrl = `https://utfs.io/f/${failedRetentionFileKey}`;
      const expiredAt = new Date(NOW.getTime() - RETENTION_MS - DAY_MS);
      await db.insert(chatbotMessagesTable).values({
        id: messageIds.failedRetentionInbound,
        conversationId: whatsappConversationA,
        tenantId: tenantA,
        role: "user",
        content: "Expired inbound attachment for cleanup recovery test",
        mediaUrl: failedRetentionFileUrl,
        mediaMimeType: "image/jpeg",
        mediaFileName: "cleanup-recovery.jpg",
        sentAt: expiredAt,
      });

      await db
        .update(platformSettingsTable)
        .set({
          value: JSON.stringify([
            {
              key: failedRetentionFileKey,
              stagedAt: Date.now() - ORPHAN_GRACE_MS - 1_000,
            },
          ]),
        })
        .where(eq(platformSettingsTable.key, STAGING_KEY));

      mockListFiles.mockReset().mockResolvedValue({
        files: [{ key: failedRetentionFileKey, name: "cleanup-recovery.jpg", size: 1234 }],
        hasMore: false,
      });
      mockDeleteFiles.mockReset().mockRejectedValue(
        new Error("Unexpected provider delete during retention failure test"),
      );

      const executeSpy = vi
        .spyOn(db, "execute")
        .mockRejectedValueOnce(new Error("Simulated retention query failure"));
      let failedRun;
      try {
        failedRun = await runUploadThingOrphanCleanup();
      } finally {
        executeSpy.mockRestore();
      }

      expect(failedRun.retention.errors).toBe(1);
      expect(failedRun.deleted).toBe(0);
      expect(failedRun.newlyStaged).toBe(0);
      expect(mockDeleteFiles).not.toHaveBeenCalled();

      const [stillReferencedMessage] = await db
        .select({
          mediaUrl: chatbotMessagesTable.mediaUrl,
          mediaExpiredAt: chatbotMessagesTable.mediaExpiredAt,
        })
        .from(chatbotMessagesTable)
        .where(eq(chatbotMessagesTable.id, messageIds.failedRetentionInbound))
        .limit(1);
      expect(stillReferencedMessage).toEqual({
        mediaUrl: failedRetentionFileUrl,
        mediaExpiredAt: null,
      });

      const [stagingAfterFailure] = await db
        .select({ value: platformSettingsTable.value })
        .from(platformSettingsTable)
        .where(eq(platformSettingsTable.key, STAGING_KEY))
        .limit(1);
      expect(JSON.parse(stagingAfterFailure?.value ?? "[]")).toEqual([]);

      const successfulRetentionRun = await runUploadThingOrphanCleanup();
      expect(successfulRetentionRun.retention.errors).toBe(0);
      expect(successfulRetentionRun.deleted).toBe(0);
      expect(successfulRetentionRun.newlyStaged).toBe(1);
      expect(mockDeleteFiles).not.toHaveBeenCalled();

      const [expiredMessage] = await db
        .select({
          mediaUrl: chatbotMessagesTable.mediaUrl,
          mediaExpiredAt: chatbotMessagesTable.mediaExpiredAt,
        })
        .from(chatbotMessagesTable)
        .where(eq(chatbotMessagesTable.id, messageIds.failedRetentionInbound))
        .limit(1);
      expect(expiredMessage).toEqual({
        mediaUrl: null,
        mediaExpiredAt: expect.any(Date),
      });

      const [stagingAfterSuccess] = await db
        .select({ value: platformSettingsTable.value })
        .from(platformSettingsTable)
        .where(eq(platformSettingsTable.key, STAGING_KEY))
        .limit(1);
      const stagedCandidates = JSON.parse(stagingAfterSuccess?.value ?? "[]") as {
        key: string;
        stagedAt: number;
      }[];
      expect(stagedCandidates).toHaveLength(1);
      expect(stagedCandidates[0]).toMatchObject({
        key: failedRetentionFileKey,
      });

      mockDeleteFiles.mockResolvedValueOnce({ deletedCount: 1 });
      const futureNowSpy = vi
        .spyOn(Date, "now")
        .mockReturnValue(stagedCandidates[0]!.stagedAt + ORPHAN_GRACE_MS + 1);
      let gracePeriodRun;
      try {
        gracePeriodRun = await runUploadThingOrphanCleanup();
      } finally {
        futureNowSpy.mockRestore();
      }

      expect(gracePeriodRun.deleted).toBe(1);
      expect(mockDeleteFiles).toHaveBeenCalledOnce();
      expect(mockDeleteFiles).toHaveBeenCalledWith([failedRetentionFileKey]);

      const [stagingAfterDeletion] = await db
        .select({ value: platformSettingsTable.value })
        .from(platformSettingsTable)
        .where(eq(platformSettingsTable.key, STAGING_KEY))
        .limit(1);
      expect(JSON.parse(stagingAfterDeletion?.value ?? "[]")).toEqual([]);
    }, 30_000);

    it("keeps the unprocessed batch referenced after a partial failure and applies the full grace period after retry", async () => {
      const partialRunTag = RUN_ID.replace(/[^a-zA-Z0-9_]/g, "_");
      const triggerName = `wa_retention_partial_${partialRunTag}`;
      const functionName = `${triggerName}_fn`;
      const fileKeys = Array.from(
        { length: 251 },
        (_, index) => `wa-retention-partial-${RUN_ID}-${String(index).padStart(3, "0")}`,
      );
      const ids = fileKeys.map(
        (_, index) => `wa-retention-partial-message-${RUN_ID}-${String(index).padStart(3, "0")}`,
      );
      partialBatchMessageIds.push(...ids);
      const failureMessageId = ids[250]!;
      const failureFileKey = fileKeys[250]!;
      const failureFileUrl = `https://utfs.io/f/${failureFileKey}`;
      const oldSentAt = new Date(Date.now() - RETENTION_MS - 2 * DAY_MS);

      await db.insert(chatbotMessagesTable).values(
        fileKeys.map((key, index) => ({
          id: ids[index]!,
          conversationId: whatsappConversationA,
          tenantId: tenantA,
          role: "user",
          content: index === 250 ? PARTIAL_FAILURE_MARKER : "Expired batch fixture",
          mediaUrl: `https://utfs.io/f/${key}`,
          mediaMimeType: "image/jpeg",
          mediaFileName: "batch-fixture.jpg",
          sentAt: oldSentAt,
        })),
      );
      await db
        .update(platformSettingsTable)
        .set({ value: "[]" })
        .where(eq(platformSettingsTable.key, STAGING_KEY));

      await pool.query(`DROP TRIGGER IF EXISTS "${triggerName}" ON public.chatbot_messages`);
      await pool.query(`
        CREATE OR REPLACE FUNCTION public."${functionName}"()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF OLD.content = '${PARTIAL_FAILURE_MARKER}' THEN
            RAISE EXCEPTION 'Simulated later retention batch failure';
          END IF;
          RETURN NEW;
        END;
        $$;
      `);
      await pool.query(`
        CREATE TRIGGER "${triggerName}"
        BEFORE UPDATE OF media_url ON public.chatbot_messages
        FOR EACH ROW
        EXECUTE FUNCTION public."${functionName}"()
      `);

      mockListFiles.mockReset().mockResolvedValue({
        files: fileKeys.map((key) => ({ key, name: "batch-fixture.jpg", size: 100 })),
        hasMore: false,
      });
      mockDeleteFiles.mockReset().mockRejectedValue(
        new Error("Unexpected delete before the 26-hour grace period"),
      );

      let partialRun;
      try {
        partialRun = await runUploadThingOrphanCleanup();
      } finally {
        await pool.query(`DROP TRIGGER IF EXISTS "${triggerName}" ON public.chatbot_messages`);
        await pool.query(`DROP FUNCTION IF EXISTS public."${functionName}"()`);
      }

      expect(partialRun.retention).toEqual({ expiredMessages: 250, errors: 1 });
      expect(partialRun.deleted).toBe(0);
      expect(partialRun.newlyStaged).toBe(250);
      expect(mockDeleteFiles).not.toHaveBeenCalled();

      const [unprocessedMessage] = await db
        .select({
          mediaUrl: chatbotMessagesTable.mediaUrl,
          mediaExpiredAt: chatbotMessagesTable.mediaExpiredAt,
        })
        .from(chatbotMessagesTable)
        .where(eq(chatbotMessagesTable.id, failureMessageId))
        .limit(1);
      expect(unprocessedMessage).toEqual({
        mediaUrl: failureFileUrl,
        mediaExpiredAt: null,
      });
      const referencedAfterPartialRun = await collectReferencedUploadThingKeys();
      expect(referencedAfterPartialRun.has(failureFileKey)).toBe(true);

      const [stagingAfterPartialRun] = await db
        .select({ value: platformSettingsTable.value })
        .from(platformSettingsTable)
        .where(eq(platformSettingsTable.key, STAGING_KEY))
        .limit(1);
      const firstRunStagedKeys = (
        JSON.parse(stagingAfterPartialRun?.value ?? "[]") as { key: string }[]
      ).map(({ key }) => key);
      expect(firstRunStagedKeys).toHaveLength(250);
      expect(firstRunStagedKeys).not.toContain(failureFileKey);

      mockListFiles.mockReset().mockResolvedValue({
        files: [{ key: failureFileKey, name: "batch-fixture.jpg", size: 100 }],
        hasMore: false,
      });
      mockDeleteFiles.mockReset();
      const retryStartedAt = Date.now();
      const retryRun = await runUploadThingOrphanCleanup();

      expect(retryRun.retention.errors).toBe(0);
      expect(retryRun.retention.expiredMessages).toBeGreaterThanOrEqual(1);
      expect(retryRun.newlyStaged).toBe(1);
      expect(retryRun.deleted).toBe(0);
      expect(mockDeleteFiles).not.toHaveBeenCalled();

      const [releasedMessage] = await db
        .select({
          mediaUrl: chatbotMessagesTable.mediaUrl,
          mediaExpiredAt: chatbotMessagesTable.mediaExpiredAt,
        })
        .from(chatbotMessagesTable)
        .where(eq(chatbotMessagesTable.id, failureMessageId))
        .limit(1);
      expect(releasedMessage).toEqual({
        mediaUrl: null,
        mediaExpiredAt: expect.any(Date),
      });

      const [stagingAfterRetry] = await db
        .select({ value: platformSettingsTable.value })
        .from(platformSettingsTable)
        .where(eq(platformSettingsTable.key, STAGING_KEY))
        .limit(1);
      const retryStaged = JSON.parse(stagingAfterRetry?.value ?? "[]") as {
        key: string;
        stagedAt: number;
      }[];
      expect(retryStaged).toEqual([{ key: failureFileKey, stagedAt: expect.any(Number) }]);
      const stagedAt = retryStaged[0]!.stagedAt;
      expect(stagedAt).toBeGreaterThanOrEqual(retryStartedAt);
      expect(stagedAt).toBeLessThanOrEqual(Date.now());

      const beforeGraceRun = vi
        .spyOn(Date, "now")
        .mockReturnValue(stagedAt + ORPHAN_GRACE_MS - 1);
      let beforeGraceResult;
      try {
        beforeGraceResult = await runUploadThingOrphanCleanup();
      } finally {
        beforeGraceRun.mockRestore();
      }
      expect(beforeGraceResult.deleted).toBe(0);
      expect(mockDeleteFiles).not.toHaveBeenCalled();

      mockDeleteFiles.mockResolvedValueOnce({ deletedCount: 1 });
      const afterGraceRun = vi
        .spyOn(Date, "now")
        .mockReturnValue(stagedAt + ORPHAN_GRACE_MS + 1);
      let afterGraceResult;
      try {
        afterGraceResult = await runUploadThingOrphanCleanup();
      } finally {
        afterGraceRun.mockRestore();
      }

      expect(afterGraceResult.deleted).toBe(1);
      expect(mockDeleteFiles).toHaveBeenCalledOnce();
      expect(mockDeleteFiles).toHaveBeenCalledWith([failureFileKey]);
    }, 30_000);
  });

  it("keeps partial UploadThing deletes staged with their original timestamps and retries the remaining files", async () => {
    const stagedAt = Date.now() - ORPHAN_GRACE_MS - 1_000;
    const fileKeys = [
      `wa-retention-partial-delete-a-${RUN_ID}`,
      `wa-retention-partial-delete-b-${RUN_ID}`,
      `wa-retention-partial-delete-c-${RUN_ID}`,
    ];
    const stagedCandidates = fileKeys.map((key) => ({ key, stagedAt }));
    await db
      .update(platformSettingsTable)
      .set({ value: JSON.stringify(stagedCandidates) })
      .where(eq(platformSettingsTable.key, STAGING_KEY));

    mockListFiles.mockReset().mockResolvedValueOnce({
      files: fileKeys.map((key) => ({ key, name: "partial-delete.jpg", size: 100 })),
      hasMore: false,
    });
    mockDeleteFiles.mockReset().mockResolvedValueOnce({ deletedCount: 1 });

    const partialResult = await runUploadThingOrphanCleanup();

    expect(partialResult.deleted).toBe(1);
    expect(partialResult.errors).toBe(2);
    const [stagingAfterPartial] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, STAGING_KEY))
      .limit(1);
    expect(JSON.parse(stagingAfterPartial?.value ?? "[]")).toEqual(stagedCandidates);

    // The provider deleted one unknown member of the first batch; only the two
    // files it left behind appear on the next listing.
    mockListFiles.mockReset().mockResolvedValueOnce({
      files: fileKeys.slice(1).map((key) => ({ key, name: "partial-delete.jpg", size: 100 })),
      hasMore: false,
    });
    mockDeleteFiles.mockReset().mockResolvedValueOnce({ deletedCount: 2 });

    const retryResult = await runUploadThingOrphanCleanup();

    expect(retryResult.deleted).toBe(2);
    expect(retryResult.errors).toBe(0);
    expect(mockDeleteFiles).toHaveBeenNthCalledWith(1, fileKeys);
    expect(mockDeleteFiles).toHaveBeenNthCalledWith(2, fileKeys.slice(1));
    const [stagingAfterRetry] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, STAGING_KEY))
      .limit(1);
    expect(JSON.parse(stagingAfterRetry?.value ?? "[]")).toEqual([]);
  }, 30_000);

  it("preserves staged candidates across an interrupted listing and deletes them after a complete retry", async () => {
    const stagedAt = Date.now() - ORPHAN_GRACE_MS - 5_000;
    const visibleKey = `wa-retention-pagination-visible-${RUN_ID}`;
    const unseenKey = `wa-retention-pagination-unseen-${RUN_ID}`;
    const stagedCandidates = [
      { key: visibleKey, stagedAt },
      { key: unseenKey, stagedAt },
    ];
    await db
      .update(platformSettingsTable)
      .set({ value: JSON.stringify(stagedCandidates) })
      .where(eq(platformSettingsTable.key, STAGING_KEY));

    mockListFiles
      .mockReset()
      .mockResolvedValueOnce({
        files: [{ key: visibleKey, name: "pagination.jpg", size: 100 }],
        hasMore: true,
      })
      .mockRejectedValueOnce(new Error("Simulated UploadThing page failure"));
    mockDeleteFiles.mockReset().mockResolvedValue({ deletedCount: 1 });

    const incompleteResult = await runUploadThingOrphanCleanup();

    expect(incompleteResult.scanned).toBe(1);
    expect(incompleteResult.errors).toBe(1);
    expect(incompleteResult.newlyStaged).toBe(0);
    expect(incompleteResult.deleted).toBe(0);
    expect(mockDeleteFiles).not.toHaveBeenCalled();
    const [stagingAfterIncomplete] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, STAGING_KEY))
      .limit(1);
    expect(JSON.parse(stagingAfterIncomplete?.value ?? "[]")).toEqual(stagedCandidates);

    mockListFiles
      .mockReset()
      .mockResolvedValueOnce({
        files: [{ key: visibleKey, name: "pagination.jpg", size: 100 }],
        hasMore: true,
      })
      .mockResolvedValueOnce({
        files: [{ key: unseenKey, name: "pagination.jpg", size: 100 }],
        hasMore: false,
      });
    mockDeleteFiles.mockReset().mockResolvedValueOnce({ deletedCount: 2 });

    const recoveredResult = await runUploadThingOrphanCleanup();

    expect(recoveredResult.errors).toBe(0);
    expect(recoveredResult.deleted).toBe(2);
    expect(mockDeleteFiles).toHaveBeenCalledOnce();
    expect(mockDeleteFiles).toHaveBeenCalledWith([visibleKey, unseenKey]);
    const [stagingAfterRecovery] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, STAGING_KEY))
      .limit(1);
    expect(JSON.parse(stagingAfterRecovery?.value ?? "[]")).toEqual([]);
  }, 30_000);
});
