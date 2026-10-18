import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  storefrontDailyMetricsTable,
  storeProductsTable,
} from "@workspace/db";
import { generateId } from "../lib/id";

export const storefrontPageTypes = ["home", "catalog", "product", "checkout", "other"] as const;
export const storefrontGroups = ["travel", "other", "all", "unknown"] as const;

const pageViewEventSchema = z.object({
  event: z.literal("page_view"),
  pageType: z.enum(storefrontPageTypes),
  group: z.enum(storefrontGroups).optional(),
}).strict();

const groupSelectionEventSchema = z.object({
  event: z.literal("group_selected"),
  group: z.enum(["all", "travel", "other"]),
  source: z.enum(["catalog_tab", "home_link"]),
}).strict();

const productOpenedEventSchema = z.object({
  event: z.literal("product_opened"),
  group: z.enum(["travel", "other", "unknown"]),
}).strict();

const searchSubmittedEventSchema = z.object({
  event: z.literal("search_submitted"),
  group: z.enum(["travel", "other", "unknown"]),
  source: z.enum(["header_search", "catalog_search"]),
}).strict();

const checkoutStartedEventSchema = z.object({
  event: z.literal("checkout_started"),
  group: z.enum(["travel", "other", "unknown"]),
}).strict();

export const storefrontMetricEventSchema = z.discriminatedUnion("event", [
  pageViewEventSchema,
  groupSelectionEventSchema,
  productOpenedEventSchema,
  searchSubmittedEventSchema,
  checkoutStartedEventSchema,
]);

export type StorefrontMetricEvent = z.infer<typeof storefrontMetricEventSchema>;
export type StorefrontPageType = (typeof storefrontPageTypes)[number];
export type StorefrontGroup = (typeof storefrontGroups)[number];

export interface StorefrontAnalyticsSummary {
  periodDays: 7 | 30 | 90;
  pageViews: {
    total: number;
    previousTotal: number;
    byDay: Array<{
      date: string;
      home: number;
      catalog: number;
      product: number;
      checkout: number;
      other: number;
    }>;
    byType: Array<{ pageType: StorefrontPageType; count: number }>;
  };
  topProducts: Array<{
    name: string;
    views: number;
    group: "travel" | "other" | "unknown";
  }>;
  groups: Array<{
    group: StorefrontGroup;
    selections: number;
    productOpens: number;
    searches: number;
    checkoutStarts: number;
  }>;
  totals: {
    productOpens: number;
    searches: number;
    checkoutStarts: number;
  };
}

type MetricRow = typeof storefrontDailyMetricsTable.$inferSelect;
type ProductRow = Pick<typeof storeProductsTable.$inferSelect, "name" | "viewsCount" | "storefrontGroup" | "tripId">;

function brazilDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values["year"]}-${values["month"]}-${values["day"]}`;
}

function shiftDate(dateValue: string, days: number): string {
  const [year, month, day] = dateValue.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

function isPageType(value: string): value is StorefrontPageType {
  return (storefrontPageTypes as readonly string[]).includes(value);
}

function isStorefrontGroup(value: string): value is StorefrontGroup {
  return (storefrontGroups as readonly string[]).includes(value);
}

export async function recordStorefrontMetric(
  store: { id: string; tenantId: string },
  event: StorefrontMetricEvent,
): Promise<void> {
  const now = new Date();
  const [pageType, groupDimension, sourceDimension] = [
    "pageType" in event ? event.pageType : "none",
    "group" in event ? event.group : "none",
    "source" in event ? event.source : "none",
  ];

  await db.insert(storefrontDailyMetricsTable).values({
    id: generateId(),
    tenantId: store.tenantId,
    storeId: store.id,
    metricDate: brazilDate(now),
    eventType: event.event,
    pageType,
    groupDimension,
    sourceDimension,
    count: 1,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [
      storefrontDailyMetricsTable.storeId,
      storefrontDailyMetricsTable.metricDate,
      storefrontDailyMetricsTable.eventType,
      storefrontDailyMetricsTable.pageType,
      storefrontDailyMetricsTable.groupDimension,
      storefrontDailyMetricsTable.sourceDimension,
    ],
    set: {
      count: sql`${storefrontDailyMetricsTable.count} + 1`,
      updatedAt: now,
    },
  });
}

function blankGroup(group: StorefrontGroup) {
  return { group, selections: 0, productOpens: 0, searches: 0, checkoutStarts: 0 };
}

export function buildStorefrontAnalyticsSummary(
  rows: MetricRow[],
  products: ProductRow[],
  periodDays: 7 | 30 | 90,
  endDate = brazilDate(),
): StorefrontAnalyticsSummary {
  const currentStart = shiftDate(endDate, 1 - periodDays);
  const previousEnd = shiftDate(currentStart, -1);
  const previousStart = shiftDate(previousEnd, 1 - periodDays);
  const byDay = new Map<string, StorefrontAnalyticsSummary["pageViews"]["byDay"][number]>();
  for (let offset = 0; offset < periodDays; offset += 1) {
    const date = shiftDate(currentStart, offset);
    byDay.set(date, { date, home: 0, catalog: 0, product: 0, checkout: 0, other: 0 });
  }

  const pageTypeTotals = new Map<StorefrontPageType, number>(
    storefrontPageTypes.map((pageType) => [pageType, 0]),
  );
  const groups = new Map<StorefrontGroup, ReturnType<typeof blankGroup>>(
    storefrontGroups.map((group) => [group, blankGroup(group)]),
  );
  let pageViewsTotal = 0;
  let previousPageViewsTotal = 0;
  const totals = { productOpens: 0, searches: 0, checkoutStarts: 0 };

  for (const row of rows) {
    const isCurrent = row.metricDate >= currentStart && row.metricDate <= endDate;
    const isPrevious = row.metricDate >= previousStart && row.metricDate <= previousEnd;
    if (!isCurrent && !isPrevious) continue;

    if (row.eventType === "page_view") {
      if (isPrevious) previousPageViewsTotal += row.count;
      if (!isCurrent || !isPageType(row.pageType)) continue;
      pageViewsTotal += row.count;
      pageTypeTotals.set(row.pageType, (pageTypeTotals.get(row.pageType) ?? 0) + row.count);
      const day = byDay.get(row.metricDate);
      if (day) day[row.pageType] += row.count;
      continue;
    }

    if (!isCurrent) continue;
    const group: StorefrontGroup = isStorefrontGroup(row.groupDimension)
      ? row.groupDimension
      : "unknown";
    const groupTotals = groups.get(group)!;
    if (row.eventType === "group_selected") {
      groupTotals.selections += row.count;
    } else if (row.eventType === "product_opened") {
      groupTotals.productOpens += row.count;
      totals.productOpens += row.count;
    } else if (row.eventType === "search_submitted") {
      groupTotals.searches += row.count;
      totals.searches += row.count;
    } else if (row.eventType === "checkout_started") {
      groupTotals.checkoutStarts += row.count;
      totals.checkoutStarts += row.count;
    }
  }

  const topProducts: StorefrontAnalyticsSummary["topProducts"] = products
    .map((product) => {
      const group: StorefrontAnalyticsSummary["topProducts"][number]["group"] =
        product.tripId
          ? "travel"
          : product.storefrontGroup === "travel" || product.storefrontGroup === "other"
            ? product.storefrontGroup
            : "unknown";
      return { name: product.name, views: product.viewsCount, group };
    })
    .sort((left, right) => right.views - left.views || left.name.localeCompare(right.name, "pt-BR"))
    .slice(0, 10);

  return {
    periodDays,
    pageViews: {
      total: pageViewsTotal,
      previousTotal: previousPageViewsTotal,
      byDay: [...byDay.values()],
      byType: storefrontPageTypes.map((pageType) => ({
        pageType,
        count: pageTypeTotals.get(pageType) ?? 0,
      })),
    },
    topProducts,
    groups: storefrontGroups.map((group) => groups.get(group)!),
    totals,
  };
}

export async function getStorefrontAnalyticsSummary(
  storeId: string,
  tenantId: string,
  periodDays: 7 | 30 | 90,
): Promise<StorefrontAnalyticsSummary> {
  const endDate = brazilDate();
  const currentStart = shiftDate(endDate, 1 - periodDays);
  const previousStart = shiftDate(currentStart, -periodDays);
  const [rows, products] = await Promise.all([
    db.select().from(storefrontDailyMetricsTable).where(and(
      eq(storefrontDailyMetricsTable.storeId, storeId),
      eq(storefrontDailyMetricsTable.tenantId, tenantId),
      gte(storefrontDailyMetricsTable.metricDate, previousStart),
      lte(storefrontDailyMetricsTable.metricDate, endDate),
    )),
    db.select({
      name: storeProductsTable.name,
      viewsCount: storeProductsTable.viewsCount,
      storefrontGroup: storeProductsTable.storefrontGroup,
      tripId: storeProductsTable.tripId,
    }).from(storeProductsTable).where(and(
      eq(storeProductsTable.storeId, storeId),
      eq(storeProductsTable.tenantId, tenantId),
      eq(storeProductsTable.status, "active"),
    )).orderBy(desc(storeProductsTable.viewsCount), asc(storeProductsTable.name)).limit(10),
  ]);

  return buildStorefrontAnalyticsSummary(rows, products, periodDays, endDate);
}
