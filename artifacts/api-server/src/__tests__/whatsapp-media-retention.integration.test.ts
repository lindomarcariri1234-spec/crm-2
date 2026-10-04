import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { mockListFiles, mockDeleteFiles } = vi.hoisted(() => ({
  mockListFiles: vi.fn(),
  mockDeleteFiles: vi.fn(),
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
};

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
}, 30_000);

afterAll(async () => {
  try {
    if (isolatedDatabaseVerified) {
      await db.transaction(async (tx) => {
        await tx
          .delete(chatbotMessagesTable)
          .where(inArray(chatbotMessagesTable.id, Object.values(messageIds)));
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
  });
});
