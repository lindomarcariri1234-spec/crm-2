import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db, tenantsTable, TENANT_ID_MAX_BYTES } from "@workspace/db";
import { generateId } from "../lib/id.js";
import {
  parseSupportTicketUpdatePayloadDetailed,
  SUPPORT_TICKET_EVENT_ID_MAX_LENGTH,
  SUPPORT_TICKET_ID_MAX_LENGTH,
  SUPPORT_TICKET_REDIS_MAX_MESSAGE_BYTES,
} from "../lib/support-ticket-sse.js";

const acceptedTenantId = `${"\u0800".repeat(16)}${generateId()}`;
const overLimitTenantId = `${acceptedTenantId}x`;
const uniqueSuffix = generateId();

function tenantInsertValues(id: string, suffix: string) {
  return {
    id,
    name: "Ticket envelope boundary test",
    slug: `ticket-envelope-boundary-${suffix}`,
    email: `ticket-envelope-boundary-${suffix}@example.test`,
  };
}

describe("tenant ID byte limit protects ticket Redis envelopes", () => {
  beforeAll(async () => {
    if (!process.env["DATABASE_URL"]) {
      throw new Error(
        "DATABASE_URL must be set to run the tenant ID byte-limit integration test",
      );
    }

    await db
      .insert(tenantsTable)
      .values(tenantInsertValues(acceptedTenantId, uniqueSuffix));
  });

  afterAll(async () => {
    if (!process.env["DATABASE_URL"]) return;
    await db
      .delete(tenantsTable)
      .where(inArray(tenantsTable.id, [acceptedTenantId, overLimitTenantId]));
  });

  it("accepts the byte limit and rejects the next byte while max ticket and queue envelopes fit", async () => {
    expect(Buffer.byteLength(acceptedTenantId, "utf8")).toBe(
      TENANT_ID_MAX_BYTES,
    );
    expect(Buffer.byteLength(overLimitTenantId, "utf8")).toBe(
      TENANT_ID_MAX_BYTES + 1,
    );

    const maxTicketPayload = {
      eventId: "\u0800".repeat(SUPPORT_TICKET_EVENT_ID_MAX_LENGTH),
      type: "ticket" as const,
      ticketId: "\u0801".repeat(SUPPORT_TICKET_ID_MAX_LENGTH),
    };
    const maxQueuesPayload = {
      eventId: "\u0802".repeat(SUPPORT_TICKET_EVENT_ID_MAX_LENGTH),
      type: "queues" as const,
      ticketId: null,
    };
    expect(parseSupportTicketUpdatePayloadDetailed(maxTicketPayload).ok).toBe(
      true,
    );
    expect(parseSupportTicketUpdatePayloadDetailed(maxQueuesPayload).ok).toBe(
      true,
    );

    const maxTicketEnvelope = JSON.stringify({
      tenantId: acceptedTenantId,
      payload: maxTicketPayload,
    });
    const maxQueuesEnvelope = JSON.stringify({
      tenantId: acceptedTenantId,
      payload: maxQueuesPayload,
    });
    expect(Buffer.byteLength(maxTicketEnvelope, "utf8")).toBe(518);
    expect(Buffer.byteLength(maxQueuesEnvelope, "utf8")).toBe(328);
    expect(Buffer.byteLength(maxTicketEnvelope, "utf8")).toBeLessThanOrEqual(
      SUPPORT_TICKET_REDIS_MAX_MESSAGE_BYTES,
    );
    expect(Buffer.byteLength(maxQueuesEnvelope, "utf8")).toBeLessThanOrEqual(
      SUPPORT_TICKET_REDIS_MAX_MESSAGE_BYTES,
    );

    await expect(
      db
        .insert(tenantsTable)
        .values(tenantInsertValues(overLimitTenantId, `${uniqueSuffix}-over`)),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "tenants_id_max_bytes_check",
    });
  });
});
