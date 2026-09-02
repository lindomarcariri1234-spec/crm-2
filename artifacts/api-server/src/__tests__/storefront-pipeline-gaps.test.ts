import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    execute: mockExecute,
  },
}));

import { findStorefrontPipelineGaps } from "../lib/storefront-pipeline-gaps.js";

describe("findStorefrontPipelineGaps", () => {
  const dialect = new PgDialect();

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue({ rows: [] });
  });

  it("returns active storefront reservations without a corresponding Pipeline card", async () => {
    mockExecute.mockResolvedValue({
      rows: [
        {
          reservation_id: "reservation-1",
          reservation_number: "AG-VI-202608-0001",
          order_number: "#2026-ABC123",
          trip_id: "trip-1",
          total_count: 2,
        },
        {
          reservation_id: "reservation-2",
          reservation_number: null,
          order_number: "#2026-DEF456",
          trip_id: "trip-2",
          total_count: 2,
        },
      ],
    });

    await expect(
      findStorefrontPipelineGaps("tenant-1"),
    ).resolves.toEqual({
      total: 2,
      gaps: [
        {
          reservationId: "reservation-1",
          reservationNumber: "AG-VI-202608-0001",
          orderNumber: "#2026-ABC123",
          tripId: "trip-1",
        },
        {
          reservationId: "reservation-2",
          reservationNumber: null,
          orderNumber: "#2026-DEF456",
          tripId: "trip-2",
        },
      ],
    });
  });

  it("scopes orders and cards to the reservation tenant and matches the exact trip", async () => {
    await findStorefrontPipelineGaps("tenant-1");

    const query = dialect.sqlToQuery(mockExecute.mock.calls[0][0]).sql;
    expect(query).toMatch(/so\.tenant_id\s*=\s*r\.tenant_id/i);
    expect(query).toMatch(/d\.tenant_id\s*=\s*r\.tenant_id/i);
    expect(query).toMatch(/d\.client_id\s*=\s*r\.client_id/i);
    expect(query).toMatch(/d\.trip_id\s*=\s*r\.trip_id/i);
    expect(query).toMatch(/where r\.tenant_id\s*=\s*\$\d+/i);
  });

  it("accepts direct reservation links and legacy client-plus-trip cards", async () => {
    await findStorefrontPipelineGaps("tenant-1");

    const query = dialect.sqlToQuery(mockExecute.mock.calls[0][0]).sql;
    expect(query).toMatch(/d\.reservation_id\s*=\s*r\.id/i);
    expect(query).toMatch(
      /d\.client_id\s*=\s*r\.client_id[\s\S]*d\.trip_id\s*=\s*r\.trip_id/i,
    );
    expect(query).toMatch(/d\.status in \(\$\d+, \$\d+\)/i);
    expect(query).toMatch(/and d\.id is null/i);
  });

  it("ignores cancelled storefront reservations and clamps the preview size", async () => {
    await findStorefrontPipelineGaps("tenant-1", 999);

    const rendered = dialect.sqlToQuery(mockExecute.mock.calls[0][0]);
    expect(rendered.sql).toMatch(/r\.status in \(\s*\$\d+,\s*\$\d+\s*\)/i);
    expect(rendered.params).toContain("pending");
    expect(rendered.params).toContain("confirmed");
    expect(rendered.params).not.toContain("cancelled");
    expect(rendered.params.at(-1)).toBe(100);
  });

  it("does not query without a tenant", async () => {
    await expect(findStorefrontPipelineGaps("")).resolves.toEqual({
      gaps: [],
      total: 0,
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });
});