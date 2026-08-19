import { db } from "@workspace/db";
import { clientNotificationsTable } from "@workspace/db";
import { eq, and, isNull, desc, count } from "drizzle-orm";
import { generateId } from "./id";
import { emitToClient } from "./client-sse";
import type { ClientNotificationType, ClientNotificationPayload } from "@workspace/db";

export async function insertClientNotification(
  clientId: string,
  tenantId: string,
  type: ClientNotificationType,
  payload: ClientNotificationPayload,
): Promise<void> {
  const id = generateId();
  await db.insert(clientNotificationsTable).values({
    id,
    clientId,
    tenantId,
    type,
    payload,
    createdAt: new Date(),
  });

  const [unreadRow] = await db
    .select({ cnt: count() })
    .from(clientNotificationsTable)
    .where(and(
      eq(clientNotificationsTable.clientId, clientId),
      eq(clientNotificationsTable.tenantId, tenantId),
      isNull(clientNotificationsTable.readAt),
    ));

  emitToClient(clientId, {
    type: "notification",
    data: {
      id,
      type,
      payload,
      readAt: null,
      createdAt: new Date().toISOString(),
      unreadCount: Number(unreadRow?.cnt ?? 0),
    },
  });
}

export async function getRecentNotifications(clientId: string, tenantId: string, limit = 20) {
  return db
    .select()
    .from(clientNotificationsTable)
    .where(and(
      eq(clientNotificationsTable.clientId, clientId),
      eq(clientNotificationsTable.tenantId, tenantId),
    ))
    .orderBy(desc(clientNotificationsTable.createdAt))
    .limit(limit);
}

export async function getUnreadCount(clientId: string, tenantId: string): Promise<number> {
  const [row] = await db
    .select({ cnt: count() })
    .from(clientNotificationsTable)
    .where(and(
      eq(clientNotificationsTable.clientId, clientId),
      eq(clientNotificationsTable.tenantId, tenantId),
      isNull(clientNotificationsTable.readAt),
    ));
  return Number(row?.cnt ?? 0);
}

export async function markAllRead(clientId: string, tenantId: string): Promise<void> {
  const now = new Date();
  await db
    .update(clientNotificationsTable)
    .set({ readAt: now })
    .where(and(
      eq(clientNotificationsTable.clientId, clientId),
      eq(clientNotificationsTable.tenantId, tenantId),
      isNull(clientNotificationsTable.readAt),
    ));

  emitToClient(clientId, { type: "all_read", data: { unreadCount: 0 } });
}
