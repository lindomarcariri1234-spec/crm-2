import { Router, type NextFunction, type Response } from "express";
import { createHash } from "node:crypto";
import sanitizeHtml from "sanitize-html";
import { db } from "@workspace/db";
import { addSeatClient, removeSeatClient } from "../lib/seat-sse";
import { broadcastSeatUpdate } from "../lib/realtime";
import { tryAddBoardingClient, removeBoardingClient, emitBoardingUpdate } from "../lib/boarding-sse";
import { getClientIp } from "../lib/get-client-ip";
import { tripsTable, tripImportBatchesTable, reservationsTable, passengersTable, clientsTable, tenantsTable, vehicleLayoutsTable, auditLogsTable, plansTable, tripMediaTable, tripCheckinsTable, tripGuideLocationsTable, referralsTable, boardingLocationsTable, type TripImportResult } from "@workspace/db";
import { checkPlanLimit } from "../lib/planLimits";
import type { LayoutCell, FixedCostItem, VariableCostItem, FreePassenger } from "@workspace/db";
import { eq, and, ilike, sql, desc, asc, inArray, or, gt, isNotNull } from "drizzle-orm";
import { generateId } from "../lib/id";
import { requireAuth, getTenantUser, MANAGEMENT_ROLES, ADMIN_ROLES } from "../lib/tenant";
import { deleteOrphanedFile } from "../lib/uploadthing";
import { hasSeatMapFeature } from "../lib/plan-features";
import { deriveAgeCategory, getAgeYears, syncIsChildUnder7 } from "../lib/passenger";
import { CreateTripBody, UpdateTripBody } from "@workspace/api-zod";
import { CalendarSyncService } from "../lib/google-calendar/sync-service";
import { scheduleCalendarSyncTrip, scheduleCalendarDeleteEventsForTrip } from "../lib/google-calendar/schedule-sync";
import { sendManifestEmail } from "@workspace/email";
import {
  dispatchReferralReversedEmail,
  enqueueReservationCancellationEmail,
  dispatchTripRestorationNotification,
} from "../queues/email-helpers";
import { cancelDealOnReservationCancellation } from "../services/pipeline-automation";
import { getPdfQueue } from "../queues/index";
import { areWorkersEnabled } from "../lib/redis";
import { logger } from "../lib/logger";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { z } from "zod";
import {
  escapeHtmlServer,
  formatCpfServer,
  seatWithPosition,
  AGE_CATEGORY_LABELS_SERVER,
  generateManifestHtml,
  generateManifestPdf,
  type ManifestPassenger,
  type ManifestPanel,
} from "../lib/manifest-helpers.js";
import { RESERVATION_STATUS, REFERRAL_STATUS, TRIP_STATUS, type TripStatus, type ReservationStatus } from "@workspace/permissions";
import { parseTripStatus } from "../lib/status-validators";
import { getPassengerExportFinancialValues } from "../lib/passenger-export";

import { AppError, ForbiddenError, NotFoundError, UnprocessableEntityError, ValidationError } from "../lib/errors";

function parseBrazilDate(dateStr: string): Date {
  return new Date(dateStr + "T12:00:00.000-03:00");
}

function tripImportFingerprint(data: { name: string; destination: string; destinationCity: string; destinationState: string }, departureDate: Date): string {
  const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");
  return [normalize(data.name), normalize(data.destination), normalize(data.destinationCity), normalize(data.destinationState), departureDate.toISOString().slice(0, 10)].join("|");
}

const ListTripsQuery = z.object({
  search: z.string().optional(),
  status: z.enum(["draft", "published", "active", "confirmed", "cancelled", "completed"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(20),
});

const TripImportRequest = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
  rows: z.array(z.object({
    line: z.number().int().min(1),
    data: z.unknown(),
  })).min(1).max(500),
}).strict();

type TripQueryExecutor = Pick<typeof db, "select">;

async function buildTripInsertValues(
  parsedData: z.infer<typeof CreateTripBody>,
  me: { tenantId: string; id: string },
  queryDb: TripQueryExecutor,
  id: string,
  isCsvImport: boolean,
) {
  const departureDate = parseBrazilDate(parsedData.departureDate);
  const slug = parsedData.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + "-" + id.slice(0, 4);
  let seatMap: Record<string, unknown> = {};
  const layout = parsedData.seatLayout ?? "2x2";
  let totalCapacity = parsedData.totalCapacity;
  let layoutId: string | null = parsedData.layoutId ?? null;

  if (layoutId) {
    const [layoutRow] = await queryDb.select().from(vehicleLayoutsTable)
      .where(and(eq(vehicleLayoutsTable.id, layoutId), eq(vehicleLayoutsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!layoutRow) throw new ValidationError("Layout não encontrado", "VALIDATION_ERROR");
    const cells = (layoutRow.cells ?? []) as LayoutCell[];
    seatMap = generateSeatMapFromLayout(cells, layoutRow.numberingType);
    totalCapacity = cells.filter(c => ["seat", "vip", "accessible"].includes(c.type)).length;
  } else {
    const cols = layout === "2x1" ? 3 : 4;
    const rows = Math.ceil(totalCapacity / cols);
    let seatNum = 1;
    for (let r = 1; r <= rows; r++) {
      for (let c = 1; c <= cols; c++) {
        if (seatNum <= totalCapacity) {
          seatMap[`${seatNum}`] = { row: r, col: c, status: "available" };
          seatNum++;
        }
      }
    }
  }

  const [tenantRow] = await queryDb
    .select({ planId: tenantsTable.planId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, me.tenantId))
    .limit(1);
  const tenantPlanId = tenantRow?.planId ?? "starter";
  const [tenantPlanRow] = await queryDb
    .select({ supportedFeatures: plansTable.supportedFeatures })
    .from(plansTable)
    .where(or(eq(plansTable.id, tenantPlanId), eq(plansTable.slug, tenantPlanId)))
    .limit(1);
  const planSupportsSeatMap = hasSeatMapFeature((tenantPlanRow?.supportedFeatures ?? []) as string[]);

  return {
    id,
    tenantId: me.tenantId,
    name: parsedData.name,
    slug,
    importFingerprint: isCsvImport ? tripImportFingerprint(parsedData, departureDate) : null,
    description: sanitizeTripDescription(parsedData.description),
    shortDescription: parsedData.shortDescription ?? null,
    destination: parsedData.destination,
    destinationCity: parsedData.destinationCity,
    destinationState: parsedData.destinationState,
    destinationCountry: parsedData.destinationCountry ?? "Brasil",
    type: parsedData.type,
    category: parsedData.category,
    departureDate,
    returnDate: parsedData.returnDate ? parseBrazilDate(parsedData.returnDate) : null,
    registrationDeadline: parsedData.registrationDeadline ? parseBrazilDate(parsedData.registrationDeadline) : null,
    totalCapacity,
    availableSeats: totalCapacity,
    priceAdult: String(parsedData.priceAdult),
    priceChild: parsedData.priceChild != null ? String(parsedData.priceChild) : null,
    priceInfant: parsedData.priceInfant != null ? String(parsedData.priceInfant) : null,
    priceSenior: parsedData.priceSenior != null ? String(parsedData.priceSenior) : null,
    reservationFee: parsedData.reservationFee != null ? String(parsedData.reservationFee) : null,
    inclusions: parsedData.inclusions ?? [],
    exclusions: parsedData.exclusions ?? [],
    coverImage: parsedData.coverImage ?? null,
    seatLayout: layout,
    layoutId,
    itinerary: parsedData.itinerary ?? null,
    boardingPoints: (parsedData.boardingPoints ?? []) as { id: string; name: string; time: string; address: string }[],
    fixedCosts: Array.isArray(parsedData.fixedCosts) ? parsedData.fixedCosts as FixedCostItem[] : [],
    variableCosts: Array.isArray(parsedData.variableCosts) ? parsedData.variableCosts as VariableCostItem[] : [],
    gallery: parsedData.gallery ?? [],
    videos: parsedData.videos ?? [],
    seatMap,
    vehiclePlate: parsedData.vehiclePlate ?? null,
    vehicleType: parsedData.vehicleType ?? null,
    driverName: parsedData.driverName ?? null,
    driverCnh: parsedData.driverCnh ?? null,
    driverPhone: parsedData.driverPhone ?? null,
    tourGuide: parsedData.tourGuide ?? null,
    tripOrganizer: parsedData.tripOrganizer ?? null,
    freeOrganizers: parsedData.freeOrganizers ?? 0,
    freeGuides: parsedData.freeGuides ?? 0,
    originCity: parsedData.originCity ?? null,
    originState: parsedData.originState ?? null,
    departureTime: parsedData.departureTime ?? null,
    returnTime: parsedData.returnTime ?? null,
    createdById: me.id,
    isPublic: parsedData.isPublic ?? false,
    isFeatured: parsedData.isFeatured ?? false,
    isAvailableInShop: parsedData.isAvailableInShop ?? false,
    ...(parsedData.status ? { status: parsedData.status } : {}),
    driver1Cpf: parsedData.driver1Cpf ?? null,
    driver1Cnh: parsedData.driver1Cnh ?? null,
    driver1CnhCategory: parsedData.driver1CnhCategory ?? null,
    driver1CnhExpiry: parsedData.driver1CnhExpiry ?? null,
    driver2Name: parsedData.driver2Name ?? null,
    driver2Cpf: parsedData.driver2Cpf ?? null,
    driver2Cnh: parsedData.driver2Cnh ?? null,
    driver2CnhCategory: parsedData.driver2CnhCategory ?? null,
    driver2CnhExpiry: parsedData.driver2CnhExpiry ?? null,
    tourGuideCpf: parsedData.tourGuideCpf ?? null,
    tourGuideRegistration: parsedData.tourGuideRegistration ?? null,
    manifestNumber: parsedData.manifestNumber ?? null,
    cancellationPolicy: parsedData.cancellationPolicy ?? null,
    metaTitle: parsedData.metaTitle ?? null,
    metaDescription: parsedData.metaDescription ?? null,
    showSeatMap: planSupportsSeatMap ? (parsedData.showSeatMap ?? true) : true,
  };
}

const ExportTripsQuery = z.object({
  format: z.enum(["json", "ndjson"]).default("json"),
});

export const EXPORT_TRIPS_BATCH_SIZE = 500;

type SeatMapEntry = { row: number; col: number; floor?: number; status: string; type?: string };

function sanitizeTripDescription(html: string | null | undefined): string | null {
  if (html == null) return null;
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2", "s", "u"]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ["src", "alt", "width", "height"],
      "*": ["class", "style"],
    },
    disallowedTagsMode: "discard",
  });
}

async function getTenantSupportedFeatures(tenantId: string): Promise<string[]> {
  const [tenantRow] = await db
    .select({ planId: tenantsTable.planId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);
  const tenantPlanId = tenantRow?.planId ?? "starter";
  const [planRow] = await db
    .select({ supportedFeatures: plansTable.supportedFeatures })
    .from(plansTable)
    .where(or(eq(plansTable.id, tenantPlanId), eq(plansTable.slug, tenantPlanId)))
    .limit(1);
  return (planRow?.supportedFeatures ?? []) as string[];
}

function generateSeatMapFromLayout(
  cells: LayoutCell[],
  numberingType: string,
): Record<string, SeatMapEntry> {
  const seatMap: Record<string, SeatMapEntry> = {};
  const seatTypes = ["seat", "vip", "accessible"] as const;

  const upperFirst = numberingType.endsWith("_upper_first");
  const baseType = upperFirst ? numberingType.replace("_upper_first", "") : numberingType;

  const seatCells = cells
    .filter(c => seatTypes.includes(c.type as (typeof seatTypes)[number]))
    .sort((a, b) => {
      const fa = a.floor ?? 1, fb = b.floor ?? 1;
      if (fa !== fb) return upperFirst ? fb - fa : fa - fb;
      if (a.row !== b.row) return a.row - b.row;
      return a.col - b.col;
    });

  const keyOf = (c: LayoutCell) => `${c.floor ?? 1}-${c.row}-${c.col}`;
  const seatLabels = new Map<string, string>();

  const maxFloor = Math.max(...cells.map(c => c.floor ?? 1), 1);
  const isMultiFloor = maxFloor > 1;

  if (baseType === "by_row") {
    // Group by (floor, row) to avoid label collisions across floors
    const floorRowGroups = new Map<string, LayoutCell[]>();
    for (const cell of seatCells) {
      const floor = cell.floor ?? 1;
      const groupKey = `${floor}-${cell.row}`;
      if (!floorRowGroups.has(groupKey)) floorRowGroups.set(groupKey, []);
      floorRowGroups.get(groupKey)!.push(cell);
    }
    for (const [groupKey, groupCells] of [...floorRowGroups.entries()].sort(([a], [b]) => {
      const [fa, ra] = a.split("-").map(Number);
      const [fb, rb] = b.split("-").map(Number);
      if (fa !== fb) return upperFirst ? fb - fa : fa - fb;
      return ra - rb;
    })) {
      const [floor, row] = groupKey.split("-").map(Number);
      groupCells.sort((a, b) => a.col - b.col);
      groupCells.forEach((cell, i) => {
        const floorPrefix = isMultiFloor ? `A${floor}-` : "";
        seatLabels.set(keyOf(cell), `${floorPrefix}${row}${String.fromCharCode(65 + i)}`);
      });
    }
  } else if (baseType === "brazilian_standard") {
    // Brazilian standard: odd = window, even = aisle, 4 seats per row front-to-back.
    // Left side (cols ≤ aisleCol): sequential ascending (1, 2, 5, 6, …).
    // Right side (cols > aisleCol): reversed within the pair so the aisle (even) seat
    // is physically closer to the corridor — e.g. row 1 → [1, 2] | [4, 3].
    const maxCol = Math.max(...seatCells.map(c => c.col), 4);
    const aisleCol = Math.ceil(maxCol / 2);

    const rowGroups = new Map<string, LayoutCell[]>();
    for (const cell of seatCells) {
      const key = `${cell.floor ?? 1}-${cell.row}`;
      if (!rowGroups.has(key)) rowGroups.set(key, []);
      rowGroups.get(key)!.push(cell);
    }

    const sortedGroups = [...rowGroups.entries()].sort(([a], [b]) => {
      const [fa, ra] = a.split("-").map(Number);
      const [fb, rb] = b.split("-").map(Number);
      if (fa !== fb) return upperFirst ? fb - fa : fa - fb;
      return ra - rb;
    });

    let counter = 1;
    for (const [, groupCells] of sortedGroups) {
      const leftCells = groupCells.filter(c => c.col <= aisleCol).sort((a, b) => a.col - b.col);
      const rightCells = groupCells.filter(c => c.col > aisleCol).sort((a, b) => a.col - b.col);

      for (const lCell of leftCells) {
        seatLabels.set(keyOf(lCell), lCell.label ?? String(counter++));
      }

      // Right side: assign in reverse col order so aisle gets the higher (even) number
      // and window gets the lower (odd) number, matching the physical corridor-first layout.
      const rightBase = counter;
      for (let i = 0; i < rightCells.length; i++) {
        seatLabels.set(keyOf(rightCells[i]), rightCells[i].label ?? String(rightBase + (rightCells.length - 1 - i)));
      }
      counter += rightCells.length;
    }
  } else {
    seatCells.forEach((cell, i) => {
      seatLabels.set(keyOf(cell), cell.label ?? String(i + 1));
    });
  }

  const nonSeatCounters: Record<string, number> = {};
  const typePrefix: Record<string, string> = { wc: "WC", stairs: "ESC", fridge: "FRG", blocked: "BLQ" };

  for (const cell of cells) {
    if (cell.type === "empty") continue;
    const k = keyOf(cell);
    if (seatTypes.includes(cell.type as (typeof seatTypes)[number])) {
      const label = cell.label || seatLabels.get(k) || String(cells.indexOf(cell) + 1);
      seatMap[label] = { row: cell.row, col: cell.col, floor: cell.floor ?? 1, status: "available", type: cell.type };
    } else {
      nonSeatCounters[cell.type] = (nonSeatCounters[cell.type] ?? 0) + 1;
      const n = nonSeatCounters[cell.type];
      const prefix = typePrefix[cell.type] ?? cell.type.toUpperCase();
      const label = `${prefix}${n > 1 ? n : ""}`;
      seatMap[label] = { row: cell.row, col: cell.col, floor: cell.floor ?? 1, status: cell.type, type: cell.type };
    }
  }

  return seatMap;
}

const router = Router();

export async function writeExportChunk(res: Response, chunk: string): Promise<void> {
  if (res.write(chunk)) return;

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      res.off("drain", onDrain);
      res.off("close", onClose);
      res.off("error", onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Export client disconnected"));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    res.once("drain", onDrain);
    res.once("close", onClose);
    res.once("error", onError);
  });
}

export function formatTrip(t: typeof tripsTable.$inferSelect) {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    description: t.description,
    shortDescription: t.shortDescription,
    destination: t.destination,
    destinationCity: t.destinationCity,
    destinationState: t.destinationState,
    destinationCountry: t.destinationCountry ?? null,
    type: t.type,
    category: t.category,
    departureDate: t.departureDate.toISOString(),
    returnDate: t.returnDate?.toISOString() ?? null,
    registrationDeadline: t.registrationDeadline?.toISOString() ?? null,
    totalCapacity: t.totalCapacity,
    availableSeats: t.availableSeats,
    reservedSeats: t.reservedSeats,
    confirmedSeats: t.confirmedSeats,
    priceAdult: Number(t.priceAdult),
    priceChild: t.priceChild ? Number(t.priceChild) : null,
    priceInfant: t.priceInfant ? Number(t.priceInfant) : null,
    priceSenior: t.priceSenior ? Number(t.priceSenior) : null,
    reservationFee: t.reservationFee ? Number(t.reservationFee) : null,
    inclusions: t.inclusions ?? [],
    exclusions: t.exclusions ?? [],
    coverImage: t.coverImage,
    gallery: t.gallery ?? [],
    videos: t.videos ?? [],
    itinerary: t.itinerary ?? [],
    boardingPoints: t.boardingPoints ?? [],
    status: t.status,
    isPublic: t.isPublic,
    isFeatured: t.isFeatured,
    isAvailableInShop: t.isAvailableInShop,
    vehiclePlate: t.vehiclePlate,
    vehicleType: t.vehicleType,
    driverName: t.driverName,
    driverCnh: t.driverCnh,
    driverPhone: t.driverPhone,
    tourGuide: t.tourGuide,
    tripOrganizer: t.tripOrganizer,
    driver1Cpf: t.driver1Cpf ?? null,
    driver1Cnh: t.driver1Cnh ?? null,
    driver1CnhCategory: t.driver1CnhCategory ?? null,
    driver1CnhExpiry: t.driver1CnhExpiry ?? null,
    driver2Name: t.driver2Name ?? null,
    driver2Cpf: t.driver2Cpf ?? null,
    driver2Cnh: t.driver2Cnh ?? null,
    driver2CnhCategory: t.driver2CnhCategory ?? null,
    driver2CnhExpiry: t.driver2CnhExpiry ?? null,
    tourGuideCpf: t.tourGuideCpf ?? null,
    tourGuideRegistration: t.tourGuideRegistration ?? null,
    manifestNumber: t.manifestNumber ?? null,
    cancellationPolicy: t.cancellationPolicy ?? null,
    metaTitle: t.metaTitle ?? null,
    metaDescription: t.metaDescription ?? null,
    seatLayout: t.seatLayout,
    layoutId: t.layoutId ?? null,
    vehicleId: t.vehicleId ?? null,
    showSeatMap: t.showSeatMap,
    fixedCosts: Array.isArray(t.fixedCosts) ? t.fixedCosts as FixedCostItem[] : [],
    variableCosts: Array.isArray(t.variableCosts) ? t.variableCosts as VariableCostItem[] : [],
    freeOrganizers: t.freeOrganizers ?? null,
    freeGuides: t.freeGuides ?? null,
    originCity: t.originCity ?? null,
    originState: t.originState ?? null,
    departureTime: t.departureTime ?? null,
    returnTime: t.returnTime ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

router.get("/trips", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    const queryResult = ListTripsQuery.safeParse(req.query);
    if (!queryResult.success) {
      next(new ValidationError(queryResult.error.errors[0]?.message ?? "Invalid query params", "VALIDATION_ERROR"));
      return;
    }
    const { search, status, page: pageNum, limit: limitNum } = queryResult.data;
    const offset = (pageNum - 1) * limitNum;

    const conditions: ReturnType<typeof eq>[] = [eq(tripsTable.tenantId, me.tenantId)];
    if (search) conditions.push(ilike(tripsTable.name, `%${search}%`) as ReturnType<typeof eq>);
    if (status) conditions.push(eq(tripsTable.status, parseTripStatus(status)));

    const activeTripCondition = inArray(tripsTable.status, [
      TRIP_STATUS.ACTIVE,
      TRIP_STATUS.CONFIRMED,
    ]);
    const [trips, [countResult], [statsResult]] = await Promise.all([
      db.select().from(tripsTable)
        .where(and(...conditions))
        .orderBy(asc(tripsTable.departureDate))
        .limit(limitNum).offset(offset),
      db.select({ count: sql<number>`count(*)` })
        .from(tripsTable).where(and(...conditions)),
      db.select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${activeTripCondition})::int`,
        totalCapacity: sql<number>`coalesce(sum(case when ${activeTripCondition} then ${tripsTable.totalCapacity} else 0 end), 0)::int`,
        occupiedSeats: sql<number>`coalesce(sum(case when ${activeTripCondition} then ${tripsTable.reservedSeats} + ${tripsTable.confirmedSeats} else 0 end), 0)::int`,
        totalRevenue: sql<number>`coalesce(sum(case when ${activeTripCondition} then (${tripsTable.reservedSeats} + ${tripsTable.confirmedSeats}) * ${tripsTable.priceAdult} else 0 end), 0)::float8`,
      }).from(tripsTable).where(eq(tripsTable.tenantId, me.tenantId)),
    ]);

    res.json({
      data: trips.map(formatTrip),
      total: Number(countResult?.count ?? 0),
      page: pageNum,
      limit: limitNum,
      stats: {
        total: Number(statsResult?.total ?? 0),
        active: Number(statsResult?.active ?? 0),
        totalCapacity: Number(statsResult?.totalCapacity ?? 0),
        occupiedSeats: Number(statsResult?.occupiedSeats ?? 0),
        totalRevenue: Number(statsResult?.totalRevenue ?? 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

// Exportação completa — processa a consulta em lotes, sem usar o limite da
// listagem paginada. Deve ficar antes de /trips/:id para que "export" não seja
// tratado como um id.
router.get("/trips/export", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE"));
      return;
    }

    const parsedQuery = ExportTripsQuery.safeParse(req.query);
    if (!parsedQuery.success) {
      next(new ValidationError("Formato de exportação inválido", "VALIDATION_ERROR"));
      return;
    }

    const { format: exportFormat } = parsedQuery.data;
    res.status(200);
    res.setHeader(
      "Content-Type",
      exportFormat === "ndjson"
        ? "application/x-ndjson; charset=utf-8"
        : "application/json; charset=utf-8",
    );
    res.setHeader("Cache-Control", "no-store");

    if (exportFormat === "json") {
      await writeExportChunk(res, '{"data":[');
    }

    let exportedCount = 0;
    let cursor: { departureDate: Date; id: string } | undefined;

    while (true) {
      // Keep the tenant predicate in every batch query. Besides enforcing
      // isolation, this means no tenant-wide result set is materialized.
      const cursorCondition = cursor
        ? or(
            gt(tripsTable.departureDate, cursor.departureDate),
            and(
              eq(tripsTable.departureDate, cursor.departureDate),
              gt(tripsTable.id, cursor.id),
            ),
          )
        : undefined;
      const batch = await db.select().from(tripsTable)
        .where(
          cursorCondition
            ? and(eq(tripsTable.tenantId, me.tenantId), cursorCondition)
            : eq(tripsTable.tenantId, me.tenantId),
        )
        .orderBy(asc(tripsTable.departureDate), asc(tripsTable.id))
        .limit(EXPORT_TRIPS_BATCH_SIZE);

      if (batch.length === 0) break;

      for (const trip of batch) {
        const formattedTrip = formatTrip(trip);
        if (exportFormat === "ndjson") {
          await writeExportChunk(res, `${JSON.stringify(formattedTrip)}\n`);
        } else {
          await writeExportChunk(
            res,
            `${exportedCount > 0 ? "," : ""}${JSON.stringify(formattedTrip)}`,
          );
        }
        exportedCount++;
      }

      const lastTrip = batch[batch.length - 1];
      cursor = {
        departureDate: lastTrip.departureDate,
        id: lastTrip.id,
      };
      if (batch.length < EXPORT_TRIPS_BATCH_SIZE) break;
    }

    if (exportFormat === "json") {
      res.end(`],"total":${exportedCount}}`);
    } else {
      res.end();
    }
  } catch (err) {
    next(err);
  }
});

router.post("/trips/import", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) {
      next(new ForbiddenError("Apenas administradores podem importar viagens", "FORBIDDEN_ROLE"));
      return;
    }

    const parsedRequest = TripImportRequest.safeParse(req.body);
    if (!parsedRequest.success) {
      next(new ValidationError(String(parsedRequest.error.message), "VALIDATION_ERROR"));
      return;
    }

    const { idempotencyKey, rows } = parsedRequest.data;
    const requestHash = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
    const validatedRows = rows.map((row) => {
      const rowData = row.data && typeof row.data === "object"
        ? row.data as { name?: unknown }
        : {};
      const name = typeof rowData.name === "string" ? rowData.name : "Viagem";
      const rowParsed = CreateTripBody.safeParse(row.data);
      if (!rowParsed.success) {
        return {
          line: row.line,
          name,
          data: undefined,
          error: `Linha ${row.line}: ${rowParsed.error.errors[0]?.message ?? "dados inválidos"}`,
        };
      }
      return { line: row.line, name: rowParsed.data.name, data: rowParsed.data, error: undefined };
    });

    type ImportTransactionResult =
      | { kind: "replay"; results: TripImportResult[] }
      | { kind: "conflict" }
      | { kind: "response"; status: number; body: Record<string, unknown> };

    let transactionResult: ImportTransactionResult;
    try {
      transactionResult = await db.transaction(async (tx): Promise<ImportTransactionResult> => {
        // Serializing on the tenant row makes the count-and-insert operation safe
        // when two browser tabs import at the same time.
        const tenantLockResult = await tx.execute(sql`
          SELECT id, status, trial_ends_at, plan_id, max_trips_override
          FROM tenants
          WHERE id = ${me.tenantId}
          FOR UPDATE
        `);
        const tenant = (tenantLockResult as unknown as {
          rows: Array<{
            id: string;
            status: string;
            trial_ends_at: Date | null;
            plan_id: string | null;
            max_trips_override: number | null;
          }>;
        }).rows[0];
        if (!tenant) {
          return { kind: "response", status: 404, body: { error: "Tenant não encontrado" } };
        }
        if (tenant.status === "suspended" || tenant.status === "cancelled" || tenant.status === "pending_payment") {
          const messages: Record<string, string> = {
            suspended: "Esta conta está suspensa.",
            cancelled: "A assinatura desta conta foi cancelada.",
            pending_payment: "É necessário concluir o pagamento para continuar.",
          };
          return {
            kind: "response",
            status: 403,
            body: { error: tenant.status === "suspended" ? "TENANT_SUSPENDED" : tenant.status === "cancelled" ? "SUBSCRIPTION_CANCELLED" : "SUBSCRIPTION_PAYMENT_REQUIRED", message: messages[tenant.status] },
          };
        }
        if (tenant.status === "trial" && tenant.trial_ends_at && tenant.trial_ends_at < new Date()) {
          return { kind: "response", status: 403, body: { error: "TRIAL_EXPIRED", message: "O período de teste expirou. Assine um plano para continuar." } };
        }

        const [existingBatch] = await tx.select().from(tripImportBatchesTable)
          .where(and(
            eq(tripImportBatchesTable.tenantId, me.tenantId),
            eq(tripImportBatchesTable.idempotencyKey, idempotencyKey),
          ))
          .limit(1);
        if (existingBatch) {
          if (existingBatch.requestHash !== requestHash) return { kind: "conflict" };
          return { kind: "replay", results: (existingBatch.results ?? []) as TripImportResult[] };
        }

        const [plan] = await tx.select({ maxTrips: plansTable.maxTrips })
          .from(plansTable)
          .where(or(
            eq(plansTable.id, tenant.plan_id ?? "starter"),
            eq(plansTable.slug, tenant.plan_id ?? "starter"),
          ))
          .limit(1);
        const maxAllowed = tenant.max_trips_override ?? plan?.maxTrips ?? 20;
        const [countRow] = await tx.select({ count: sql<number>`count(*)` })
          .from(tripsTable)
          .where(eq(tripsTable.tenantId, me.tenantId));
        const currentCount = Number(countRow?.count ?? 0);

        const existingFingerprints = await tx.select({
          id: tripsTable.id,
          importFingerprint: tripsTable.importFingerprint,
        }).from(tripsTable).where(and(
          eq(tripsTable.tenantId, me.tenantId),
          isNotNull(tripsTable.importFingerprint),
        ));
        const fingerprintToTripId = new Map(
          existingFingerprints
            .filter((trip): trip is { id: string; importFingerprint: string } => Boolean(trip.importFingerprint))
            .map((trip) => [trip.importFingerprint, trip.id]),
        );

        const validNewFingerprints = new Set<string>();
        for (const row of validatedRows) {
          if (!row.data) continue;
          const fingerprint = tripImportFingerprint(row.data, parseBrazilDate(row.data.departureDate));
          if (!fingerprintToTripId.has(fingerprint)) validNewFingerprints.add(fingerprint);
        }
        const limitError = currentCount + validNewFingerprints.size > maxAllowed
          ? `Limite do plano atingido: máximo de ${maxAllowed} viagens. Faça upgrade para continuar.`
          : undefined;
        const results: TripImportResult[] = [];
        const createdTripIds: string[] = [];

        for (const row of validatedRows) {
          if (!row.data) {
            results.push({ line: row.line, name: row.name, status: "error", error: row.error });
            continue;
          }
          const fingerprint = tripImportFingerprint(row.data, parseBrazilDate(row.data.departureDate));
          const duplicateTripId = fingerprintToTripId.get(fingerprint);
          if (duplicateTripId) {
            results.push({ line: row.line, name: row.name, status: "duplicate", tripId: duplicateTripId });
            continue;
          }
          if (limitError) {
            results.push({ line: row.line, name: row.name, status: "error", error: limitError });
            continue;
          }

          const id = generateId();
          const values = await buildTripInsertValues(row.data, me, tx, id, true);
          const inserted = await tx.insert(tripsTable).values(values).onConflictDoNothing({
            target: [tripsTable.tenantId, tripsTable.importFingerprint],
          }).returning({ id: tripsTable.id });
          if (!inserted.length) {
            results.push({ line: row.line, name: row.name, status: "duplicate" });
            continue;
          }
          fingerprintToTripId.set(fingerprint, id);
          createdTripIds.push(id);
          results.push({ line: row.line, name: row.name, status: "created", tripId: id });
        }

        const batchId = generateId();
        await tx.insert(tripImportBatchesTable).values({
          id: batchId,
          tenantId: me.tenantId,
          idempotencyKey,
          requestHash,
          status: "completed",
          results,
          createdById: me.id,
        });
        return { kind: "response", status: 200, body: { importId: batchId, results, createdTripIds } };
      });
    } catch (error) {
      logger.error({ err: error, tenantId: me.tenantId, idempotencyKey }, "[trips] import transaction rolled back");
      next(new AppError(
        "Importação não concluída; nenhuma viagem foi criada. Tente novamente com a mesma chave.",
        500,
        "TRIP_IMPORT_FAILED",
      ));
      return;
    }

    if (transactionResult.kind === "conflict") {
      res.status(409).json({
        error: "A chave de importação já foi usada com outro lote.",
        code: "TRIP_IMPORT_IDEMPOTENCY_CONFLICT",
      });
      return;
    }
    if (transactionResult.kind === "replay") {
      res.status(200).json({ replayed: true, results: transactionResult.results });
      return;
    }
    res.status(transactionResult.status).json(transactionResult.body);
    if (transactionResult.body.createdTripIds && Array.isArray(transactionResult.body.createdTripIds)) {
      for (const tripId of transactionResult.body.createdTripIds as string[]) {
        scheduleCalendarSyncTrip(tripId).catch((err) => logger.warn({ err }, "[trips] calendar sync (import) failed"));
      }
    }
  } catch (err) {
    next(err);
  }
});

router.post("/trips", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Apenas administradores podem criar viagens", "FORBIDDEN_ROLE")); return; }
    const parsed = CreateTripBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    const isTripCsvImport = req.get("x-visitecrm-import") === "trip-csv";
    const departureDate = parseBrazilDate(parsed.data.departureDate);

    if (me.tenantId) {
      const allowed = await checkPlanLimit(me.tenantId, "trips", req, res);
      if (!allowed) return;
    }

    const id = generateId();
    const slug = parsed.data.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + "-" + id.slice(0, 4);

    let seatMap: Record<string, unknown> = {};
    const layout = parsed.data.seatLayout ?? "2x2";
    let totalCapacity = parsed.data.totalCapacity;
    let layoutId: string | null = parsed.data.layoutId ?? null;

    if (layoutId) {
      const [layoutRow] = await db.select().from(vehicleLayoutsTable)
        .where(and(eq(vehicleLayoutsTable.id, layoutId), eq(vehicleLayoutsTable.tenantId, me.tenantId)))
        .limit(1);
      if (!layoutRow) { next(new ValidationError("Layout não encontrado", "VALIDATION_ERROR")); return; }
      const cells = (layoutRow.cells ?? []) as LayoutCell[];
      seatMap = generateSeatMapFromLayout(cells, layoutRow.numberingType);
      const seatCount = cells.filter(c => ["seat", "vip", "accessible"].includes(c.type)).length;
      totalCapacity = seatCount;
    } else {
      const cols = layout === "2x1" ? 3 : 4;
      const rows = Math.ceil(totalCapacity / cols);
      let seatNum = 1;
      for (let r = 1; r <= rows; r++) {
        for (let c = 1; c <= cols; c++) {
          if (seatNum <= totalCapacity) {
            seatMap[`${seatNum}`] = { row: r, col: c, status: "available" };
            seatNum++;
          }
        }
      }
    }

    const [tenantRow] = await db
      .select({ planId: tenantsTable.planId })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, me.tenantId))
      .limit(1);
    const tenantPlanId = tenantRow?.planId ?? "starter";
    const [tenantPlanRow] = await db
      .select({ supportedFeatures: plansTable.supportedFeatures })
      .from(plansTable)
      .where(or(eq(plansTable.id, tenantPlanId), eq(plansTable.slug, tenantPlanId)))
      .limit(1);
    const planSupportsSeatMap = hasSeatMapFeature((tenantPlanRow?.supportedFeatures ?? []) as string[]);
    const resolvedShowSeatMap = planSupportsSeatMap ? (parsed.data.showSeatMap ?? true) : true;

    const values = {
      id,
      tenantId: me.tenantId,
      name: parsed.data.name,
      slug,
      importFingerprint: isTripCsvImport ? tripImportFingerprint(parsed.data, departureDate) : null,
      description: sanitizeTripDescription(parsed.data.description),
      shortDescription: parsed.data.shortDescription ?? null,
      destination: parsed.data.destination,
      destinationCity: parsed.data.destinationCity,
      destinationState: parsed.data.destinationState,
      destinationCountry: parsed.data.destinationCountry ?? "Brasil",
      type: parsed.data.type,
      category: parsed.data.category,
      departureDate,
      returnDate: parsed.data.returnDate ? parseBrazilDate(parsed.data.returnDate) : null,
      registrationDeadline: parsed.data.registrationDeadline ? parseBrazilDate(parsed.data.registrationDeadline) : null,
      totalCapacity,
      availableSeats: totalCapacity,
      priceAdult: String(parsed.data.priceAdult),
      priceChild: parsed.data.priceChild != null ? String(parsed.data.priceChild) : null,
      priceInfant: parsed.data.priceInfant != null ? String(parsed.data.priceInfant) : null,
      priceSenior: parsed.data.priceSenior != null ? String(parsed.data.priceSenior) : null,
      reservationFee: parsed.data.reservationFee != null ? String(parsed.data.reservationFee) : null,
      inclusions: parsed.data.inclusions ?? [],
      exclusions: parsed.data.exclusions ?? [],
      coverImage: parsed.data.coverImage ?? null,
      seatLayout: layout,
      layoutId: layoutId ?? null,
      itinerary: parsed.data.itinerary ?? null,
      boardingPoints: (parsed.data.boardingPoints ?? []) as { id: string; name: string; time: string; address: string }[],
      fixedCosts: Array.isArray(parsed.data.fixedCosts) ? (parsed.data.fixedCosts as FixedCostItem[]) : [],
      variableCosts: Array.isArray(parsed.data.variableCosts) ? (parsed.data.variableCosts as VariableCostItem[]) : [],
      gallery: parsed.data.gallery ?? [],
      videos: parsed.data.videos ?? [],
      seatMap,
      vehiclePlate: parsed.data.vehiclePlate ?? null,
      vehicleType: parsed.data.vehicleType ?? null,
      driverName: parsed.data.driverName ?? null,
      driverCnh: parsed.data.driverCnh ?? null,
      driverPhone: parsed.data.driverPhone ?? null,
      tourGuide: parsed.data.tourGuide ?? null,
      tripOrganizer: parsed.data.tripOrganizer ?? null,
      freeOrganizers: parsed.data.freeOrganizers ?? 0,
      freeGuides: parsed.data.freeGuides ?? 0,
      originCity: parsed.data.originCity ?? null,
      originState: parsed.data.originState ?? null,
      departureTime: parsed.data.departureTime ?? null,
      returnTime: parsed.data.returnTime ?? null,
      createdById: me.id,
      isPublic: parsed.data.isPublic ?? false,
      isFeatured: parsed.data.isFeatured ?? false,
      isAvailableInShop: parsed.data.isAvailableInShop ?? false,
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      driver1Cpf: parsed.data.driver1Cpf ?? null,
      driver1Cnh: parsed.data.driver1Cnh ?? null,
      driver1CnhCategory: parsed.data.driver1CnhCategory ?? null,
      driver1CnhExpiry: parsed.data.driver1CnhExpiry ?? null,
      driver2Name: parsed.data.driver2Name ?? null,
      driver2Cpf: parsed.data.driver2Cpf ?? null,
      driver2Cnh: parsed.data.driver2Cnh ?? null,
      driver2CnhCategory: parsed.data.driver2CnhCategory ?? null,
      driver2CnhExpiry: parsed.data.driver2CnhExpiry ?? null,
      tourGuideCpf: parsed.data.tourGuideCpf ?? null,
      tourGuideRegistration: parsed.data.tourGuideRegistration ?? null,
      manifestNumber: parsed.data.manifestNumber ?? null,
      cancellationPolicy: parsed.data.cancellationPolicy ?? null,
      metaTitle: parsed.data.metaTitle ?? null,
      metaDescription: parsed.data.metaDescription ?? null,
      showSeatMap: resolvedShowSeatMap,
    };
    const inserted = isTripCsvImport
      ? await db.insert(tripsTable).values(values).onConflictDoNothing({
        target: [tripsTable.tenantId, tripsTable.importFingerprint],
      }).returning({ id: tripsTable.id })
      : await db.insert(tripsTable).values(values).returning({ id: tripsTable.id });
    if (!inserted.length) {
      res.status(409).json({
        error: "Já existe uma viagem com o mesmo nome, destino e data de saída nesta agência.",
        code: "TRIP_IMPORT_DUPLICATE",
      });
      return;
    }

    const [trip] = await db.select().from(tripsTable)
      .where(and(eq(tripsTable.id, id), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new AppError("Failed to create trip", 500, "TRIP_CREATE_FAILED")); return; }
    res.status(201).json(formatTrip(trip));
    scheduleCalendarSyncTrip(id).catch((err) => logger.warn({ err }, "[trips] calendar sync (create) failed"));
  } catch (err) {
    next(err);
  }
});

// Global media gallery — all trip_media records for this tenant across all trips.
// Must be registered BEFORE /trips/:id to prevent "media" being captured as an id.
router.get("/trips/media", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) { next(new ForbiddenError("Acesso restrito", "FORBIDDEN_ROLE")); return; }

    const limitRaw = Math.min(Math.max(parseInt(String(req.query.limit ?? "50")) || 50, 1), 200);
    const offsetRaw = Math.max(parseInt(String(req.query.offset ?? "0")) || 0, 0);
    const typeParam = req.query.type === "image" || req.query.type === "video" ? req.query.type : null;
    const tripIdParam = req.query.tripId ? String(req.query.tripId) : null;

    const conditions: ReturnType<typeof eq>[] = [eq(tripMediaTable.tenantId, me.tenantId)];
    if (typeParam) conditions.push(eq(tripMediaTable.type, typeParam) as ReturnType<typeof eq>);
    if (tripIdParam) conditions.push(eq(tripMediaTable.tripId, tripIdParam) as ReturnType<typeof eq>);

    const [countRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(tripMediaTable)
      .where(and(...conditions));

    const rows = await db
      .select({
        id: tripMediaTable.id,
        url: tripMediaTable.url,
        type: tripMediaTable.type,
        caption: tripMediaTable.caption,
        uploadedByUserId: tripMediaTable.uploadedByUserId,
        createdAt: tripMediaTable.createdAt,
        tripId: tripMediaTable.tripId,
        tripName: tripsTable.name,
        tripSlug: tripsTable.slug,
      })
      .from(tripMediaTable)
      .innerJoin(tripsTable, eq(tripMediaTable.tripId, tripsTable.id))
      .where(and(...conditions))
      .orderBy(desc(tripMediaTable.createdAt))
      .limit(limitRaw)
      .offset(offsetRaw);

    res.json({
      data: rows.map((m) => ({
        id: m.id,
        url: m.url,
        type: m.type,
        caption: m.caption,
        tripId: m.tripId,
        tripName: m.tripName,
        tripSlug: m.tripSlug,
        uploadedByUserId: m.uploadedByUserId,
        createdAt: m.createdAt.toISOString(),
      })),
      total: Number(countRow?.count ?? 0),
      limit: limitRaw,
      offset: offsetRaw,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/trips/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const [trip] = await db.select().from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Trip not found", "TRIP_NOT_FOUND")); return; }
    res.json(formatTrip(trip));
  } catch (err) {
    next(err);
  }
});

router.patch("/trips/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = UpdateTripBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }

    const updates: Partial<typeof tripsTable.$inferInsert> = {};
    if (parsed.data.name != null) updates.name = parsed.data.name;
    if (parsed.data.description !== undefined) updates.description = sanitizeTripDescription(parsed.data.description);
    if (parsed.data.status != null) updates.status = parseTripStatus(parsed.data.status);
    if (parsed.data.isPublic != null) updates.isPublic = parsed.data.isPublic;
    if (parsed.data.isFeatured != null) updates.isFeatured = parsed.data.isFeatured;
    if (parsed.data.departureDate != null) updates.departureDate = parseBrazilDate(parsed.data.departureDate);
    if (parsed.data.returnDate !== undefined) updates.returnDate = parsed.data.returnDate ? parseBrazilDate(parsed.data.returnDate) : null;
    if (parsed.data.priceAdult != null) updates.priceAdult = String(parsed.data.priceAdult);
    if (parsed.data.priceChild !== undefined) updates.priceChild = parsed.data.priceChild ? String(parsed.data.priceChild) : null;
    if (parsed.data.priceSenior !== undefined) updates.priceSenior = parsed.data.priceSenior ? String(parsed.data.priceSenior) : null;
    if (parsed.data.totalCapacity != null) updates.totalCapacity = parsed.data.totalCapacity;
    if (parsed.data.coverImage !== undefined) updates.coverImage = parsed.data.coverImage ?? null;
    if (parsed.data.seatLayout !== undefined) updates.seatLayout = parsed.data.seatLayout ?? null;
    if (parsed.data.layoutId !== undefined) updates.layoutId = parsed.data.layoutId ?? null;

    // Cancelling a trip also cancels its reservations. Restoring the trip must
    // not silently make those reservations active again: keep them cancelled
    // and notify each affected client that they need to book again.
    const isRestoringCancelledTrip =
      parsed.data.status != null &&
      (
        parsed.data.status === TRIP_STATUS.PUBLISHED ||
        parsed.data.status === TRIP_STATUS.CONFIRMED ||
        parsed.data.status === TRIP_STATUS.ACTIVE
      );
    const restoredReservations: Array<{ id: string; clientId: string | null }> = [];
    if (isRestoringCancelledTrip) {
      const [currentTrip] = await db
        .select({ status: tripsTable.status })
        .from(tripsTable)
        .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
        .limit(1);
      if (!currentTrip) { next(new NotFoundError("Trip not found", "TRIP_NOT_FOUND")); return; }

      if (currentTrip.status === TRIP_STATUS.CANCELLED) {
        const affectedReservations = await db
          .select({ id: reservationsTable.id, clientId: reservationsTable.clientId })
          .from(reservationsTable)
          .where(and(
            eq(reservationsTable.tripId, req.params.id),
            eq(reservationsTable.tenantId, me.tenantId),
            eq(reservationsTable.status, RESERVATION_STATUS.CANCELLED),
          ));
        restoredReservations.push(...affectedReservations);
      }
    }
    const [patchTenantRow] = await db
      .select({ planId: tenantsTable.planId })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, me.tenantId))
      .limit(1);
    const patchTenantPlanId = patchTenantRow?.planId ?? "starter";
    const [patchTenantPlanRow] = await db
      .select({ supportedFeatures: plansTable.supportedFeatures })
      .from(plansTable)
      .where(or(eq(plansTable.id, patchTenantPlanId), eq(plansTable.slug, patchTenantPlanId)))
      .limit(1);
    const patchPlanSupportsSeatMap = hasSeatMapFeature((patchTenantPlanRow?.supportedFeatures ?? []) as string[]);
    if (!patchPlanSupportsSeatMap) {
      updates.showSeatMap = true;
    } else if (parsed.data.showSeatMap != null) {
      updates.showSeatMap = parsed.data.showSeatMap;
    }

    // Free-passenger seat conflict check
    if (parsed.data.freePassengers !== undefined) {
      const newFpList = parsed.data.freePassengers;
      const fpSeats = newFpList
        .map(fp => fp.seatNumber?.trim() ?? null)
        .filter((s): s is string => s != null && s !== "");
      const duplicateSeats = [...new Set(
        fpSeats.filter((seat, index) => fpSeats.indexOf(seat) !== index),
      )];
      if (duplicateSeats.length > 0) {
        next(new UnprocessableEntityError(
          "O mesmo assento não pode ser atribuído a mais de um passageiro gratuito",
          "DUPLICATE_FREE_PASSENGER_SEAT",
          { conflictingSeats: duplicateSeats },
        ));
        return;
      }
      if (fpSeats.length > 0) {
        const activeResRows = await db
          .select({ seats: reservationsTable.seats })
          .from(reservationsTable)
          .where(and(
            eq(reservationsTable.tripId, req.params.id),
            eq(reservationsTable.tenantId, me.tenantId),
            inArray(reservationsTable.status, [RESERVATION_STATUS.PENDING, RESERVATION_STATUS.CONFIRMED]),
          ));
        const occupiedSet = new Set<string>(activeResRows.flatMap(r => r.seats));
        const conflictingSeats = fpSeats.filter(s => occupiedSet.has(s));
        if (conflictingSeats.length > 0) {
          next(new UnprocessableEntityError("Conflito de assento com reserva ativa", "SEAT_CONFLICT", { conflictingSeats }));
          return;
        }
      }
      updates.freePassengers = newFpList as FreePassenger[];
      const [fpCurrentTrip] = await db.select().from(tripsTable)
        .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
        .limit(1);
      if (fpCurrentTrip) {
        const newFpCount = newFpList.length;
        updates.availableSeats = Math.max(
          0,
          fpCurrentTrip.totalCapacity - fpCurrentTrip.reservedSeats - fpCurrentTrip.confirmedSeats - newFpCount,
        );
      }
    }

    const capacityOrLayoutChanged =
      parsed.data.totalCapacity != null || parsed.data.seatLayout !== undefined || parsed.data.layoutId !== undefined;
    const coverImageChanged = parsed.data.coverImage !== undefined;

    if (parsed.data.inclusions != null) updates.inclusions = parsed.data.inclusions;
    if (parsed.data.exclusions != null) updates.exclusions = parsed.data.exclusions;
    if (parsed.data.vehiclePlate !== undefined) updates.vehiclePlate = parsed.data.vehiclePlate ?? null;
    if (parsed.data.vehicleType !== undefined) updates.vehicleType = parsed.data.vehicleType ?? null;
    if (parsed.data.driverName !== undefined) updates.driverName = parsed.data.driverName ?? null;
    if (parsed.data.tourGuide !== undefined) updates.tourGuide = parsed.data.tourGuide ?? null;
    if (parsed.data.tripOrganizer !== undefined) updates.tripOrganizer = parsed.data.tripOrganizer ?? null;
    if (parsed.data.destination !== undefined) updates.destination = parsed.data.destination ?? "";
    if (parsed.data.destinationCity !== undefined) updates.destinationCity = parsed.data.destinationCity ?? "";
    if (parsed.data.destinationState !== undefined) updates.destinationState = parsed.data.destinationState ?? "";
    if (parsed.data.type !== undefined) updates.type = parsed.data.type ?? "";
    if (parsed.data.category !== undefined) updates.category = parsed.data.category ?? "";
    if (parsed.data.itinerary !== undefined) updates.itinerary = parsed.data.itinerary ?? null;
    if (parsed.data.boardingPoints !== undefined) updates.boardingPoints = (parsed.data.boardingPoints ?? []) as { id: string; name: string; time: string; address: string }[];
    if (parsed.data.fixedCosts !== undefined) updates.fixedCosts = Array.isArray(parsed.data.fixedCosts) ? (parsed.data.fixedCosts as FixedCostItem[]) : [];
    if (parsed.data.variableCosts !== undefined) updates.variableCosts = Array.isArray(parsed.data.variableCosts) ? (parsed.data.variableCosts as VariableCostItem[]) : [];
    if (parsed.data.gallery !== undefined) updates.gallery = parsed.data.gallery ?? [];
    if (parsed.data.videos !== undefined) updates.videos = parsed.data.videos ?? [];
    if (parsed.data.originCity !== undefined) updates.originCity = parsed.data.originCity ?? null;
    if (parsed.data.originState !== undefined) updates.originState = parsed.data.originState ?? null;
    if (parsed.data.departureTime !== undefined) updates.departureTime = parsed.data.departureTime ?? null;
    if (parsed.data.returnTime !== undefined) updates.returnTime = parsed.data.returnTime ?? null;
    if (parsed.data.driver1Cpf !== undefined) updates.driver1Cpf = parsed.data.driver1Cpf ?? null;
    if (parsed.data.driver1Cnh !== undefined) updates.driver1Cnh = parsed.data.driver1Cnh ?? null;
    if (parsed.data.driver1CnhCategory !== undefined) updates.driver1CnhCategory = parsed.data.driver1CnhCategory ?? null;
    if (parsed.data.driver1CnhExpiry !== undefined) updates.driver1CnhExpiry = parsed.data.driver1CnhExpiry ?? null;
    if (parsed.data.driver2Name !== undefined) updates.driver2Name = parsed.data.driver2Name ?? null;
    if (parsed.data.driver2Cpf !== undefined) updates.driver2Cpf = parsed.data.driver2Cpf ?? null;
    if (parsed.data.driver2Cnh !== undefined) updates.driver2Cnh = parsed.data.driver2Cnh ?? null;
    if (parsed.data.driver2CnhCategory !== undefined) updates.driver2CnhCategory = parsed.data.driver2CnhCategory ?? null;
    if (parsed.data.driver2CnhExpiry !== undefined) updates.driver2CnhExpiry = parsed.data.driver2CnhExpiry ?? null;
    if (parsed.data.tourGuideCpf !== undefined) updates.tourGuideCpf = parsed.data.tourGuideCpf ?? null;
    if (parsed.data.tourGuideRegistration !== undefined) updates.tourGuideRegistration = parsed.data.tourGuideRegistration ?? null;

    let oldCoverImage: string | null | undefined;
    if (capacityOrLayoutChanged || coverImageChanged) {
      const [currentTrip] = await db.select().from(tripsTable)
        .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
        .limit(1);
      if (!currentTrip) { next(new NotFoundError("Trip not found", "TRIP_NOT_FOUND")); return; }
      if (coverImageChanged) oldCoverImage = currentTrip.coverImage;

      if (capacityOrLayoutChanged) {
        const newLayoutId = parsed.data.layoutId !== undefined
          ? (parsed.data.layoutId ?? null)
          : (currentTrip.layoutId ?? null);

        let newSeatMap: Record<string, { row: number; col: number; status: string; type?: string }> = {};
        let newCapacity = parsed.data.totalCapacity ?? currentTrip.totalCapacity;

        if (newLayoutId) {
          const [layoutRow] = await db.select().from(vehicleLayoutsTable)
            .where(and(eq(vehicleLayoutsTable.id, newLayoutId), eq(vehicleLayoutsTable.tenantId, me.tenantId)))
            .limit(1);
          if (!layoutRow) { next(new ValidationError("Layout não encontrado", "VALIDATION_ERROR")); return; }
          const cells = (layoutRow.cells ?? []) as LayoutCell[];
          const generated = generateSeatMapFromLayout(cells, layoutRow.numberingType);
          newSeatMap = generated as typeof newSeatMap;
          newCapacity = cells.filter(c => ["seat", "vip", "accessible"].includes(c.type)).length;
          updates.totalCapacity = newCapacity;
        } else {
          const newLayout = parsed.data.seatLayout ?? currentTrip.seatLayout ?? "2x2";
          const newCols = newLayout === "2x1" ? 3 : 4;
          const newRows = Math.ceil(newCapacity / newCols);
          let seatNum = 1;
          for (let r = 1; r <= newRows; r++) {
            for (let c = 1; c <= newCols; c++) {
              if (seatNum <= newCapacity) {
                newSeatMap[`${seatNum}`] = { row: r, col: c, status: "available" };
                seatNum++;
              }
            }
          }
        }

        const activeReservations = await db.select().from(reservationsTable)
          .where(and(
            eq(reservationsTable.tripId, req.params.id),
            eq(reservationsTable.tenantId, me.tenantId),
            inArray(reservationsTable.status, [RESERVATION_STATUS.PENDING, RESERVATION_STATUS.CONFIRMED]),
          ));

        let reservedSeats = 0;
        let confirmedSeats = 0;
        for (const r of activeReservations) {
          for (const seat of r.seats) {
            if (newSeatMap[seat]) {
              newSeatMap[seat].status = r.status === RESERVATION_STATUS.CONFIRMED ? "confirmed" : "reserved";
              if (r.status === RESERVATION_STATUS.CONFIRMED) confirmedSeats++;
              else reservedSeats++;
            }
          }
        }
        const occupiedTotal = reservedSeats + confirmedSeats;
        const fpCount = Array.isArray(currentTrip.freePassengers) ? (currentTrip.freePassengers as FreePassenger[]).length : 0;
        updates.seatMap = newSeatMap;
        updates.availableSeats = Math.max(0, newCapacity - occupiedTotal - fpCount);
        updates.reservedSeats = reservedSeats;
        updates.confirmedSeats = confirmedSeats;
      }
    }

    // When cancelling, wrap the trip update, reservation bulk-cancellation, and
    // referral reversals in a single transaction so all succeed or all roll back.
    if (parsed.data.status === "cancelled") {
      // Fetch ALL active reservations — needed for both bulk cancellation and
      // pipeline deal updates. A superset query avoids a second round-trip.
      const allActiveReservations = await db
        .select({
          id: reservationsTable.id,
          clientId: reservationsTable.clientId,
          discountReferralCode: reservationsTable.discountReferralCode,
        })
        .from(reservationsTable)
        .where(and(
          eq(reservationsTable.tripId, req.params.id),
          eq(reservationsTable.tenantId, me.tenantId),
          inArray(reservationsTable.status, [RESERVATION_STATUS.PENDING, RESERVATION_STATUS.CONFIRMED]),
        ));
      const allActiveReservationIds = allActiveReservations.map(r => r.id);

      // Referral reversals only apply to reservations that carried a referral code.
      const referralReservationIds = allActiveReservations
        .filter(r => r.discountReferralCode != null)
        .map(r => r.id);
      const referralsToReverse = referralReservationIds.length > 0
        ? await db
            .select({
              id: referralsTable.id,
              referrerId: referralsTable.referrerId,
              referredId: referralsTable.referredId,
              bonusAmount: referralsTable.bonusAmount,
            })
            .from(referralsTable)
            .where(and(
              eq(referralsTable.tenantId, me.tenantId),
              eq(referralsTable.status, REFERRAL_STATUS.COMPLETED),
              inArray(referralsTable.reservationId, referralReservationIds),
            ))
        : [];

      const tripReversalNow = new Date();
      await db.transaction(async (tx) => {
        await tx.update(tripsTable).set(updates)
          .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)));
        // Bulk-cancel all active reservations atomically with the trip cancellation.
        if (allActiveReservationIds.length > 0) {
          await tx.update(reservationsTable)
            .set({ status: RESERVATION_STATUS.CANCELLED, cancelledAt: tripReversalNow, updatedAt: tripReversalNow })
            .where(and(
              inArray(reservationsTable.id, allActiveReservationIds),
              eq(reservationsTable.tenantId, me.tenantId),
            ));
        }
        for (const ref of referralsToReverse) {
          const bonusToReverse = Number(ref.bonusAmount);
          await tx.execute(
            sql`SELECT id FROM clients WHERE id = ${ref.referrerId} AND tenant_id = ${me.tenantId} FOR UPDATE`
          );
          await tx.update(clientsTable)
            .set({
              successfulReferrals: sql`GREATEST(0, COALESCE(successful_referrals, 0) - 1)`,
              referralEarnings: sql`GREATEST(0, COALESCE(referral_earnings, 0) - ${bonusToReverse.toFixed(2)})`,
            })
            .where(and(
              eq(clientsTable.id, ref.referrerId),
              eq(clientsTable.tenantId, me.tenantId),
            ));
          await tx.update(referralsTable)
            .set({ status: REFERRAL_STATUS.REVERSED, reversalReason: "trip_cancelled", reversalAt: tripReversalNow, updatedAt: tripReversalNow })
            .where(eq(referralsTable.id, ref.id));
        }
      });

      // Fire-and-forget: move each open Pipeline deal to "Cancelado".
      // Called after the transaction so the cancelled reservation rows are visible
      // to cancelDealOnReservationCancellation's "other active reservation" check.
      for (const r of allActiveReservations) {
        if (r.clientId) {
          cancelDealOnReservationCancellation({ tenantId: me.tenantId, reservationId: r.id })
            .catch((err) => req.log.error({ err, reservationId: r.id }, "[trips] Error cancelling pipeline deal on trip cancellation"));
        }
      }

      // Fire-and-forget: send a cancellation email to each affected client.
      // Mirrors the per-reservation cancellation email dispatched by reservations.ts.
      for (const r of allActiveReservations) {
        enqueueReservationCancellationEmail(r.id, me.tenantId)
          .catch((err) => req.log.error({ err, reservationId: r.id }, "[trips] Error enqueuing cancellation email on trip cancellation"));
      }

      // Fire-and-forget reversal emails after the transaction commits.
      for (const ref of referralsToReverse) {
        dispatchReferralReversedEmail({
          referrerId: ref.referrerId,
          referredId: ref.referredId,
          bonusAmount: ref.bonusAmount,
          tenantId: me.tenantId,
          reason: "trip_cancelled",
        }).catch((err) => req.log.error({ err, referralId: ref.id }, "Error sending trip cancellation referral reversal email"));
      }
    } else {
      await db.update(tripsTable).set(updates)
        .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)));
    }

    const [trip] = await db.select().from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Trip not found", "TRIP_NOT_FOUND")); return; }
    if (coverImageChanged) {
      await deleteOrphanedFile(oldCoverImage, parsed.data.coverImage, req.log, me.tenantId);
    }
    res.json(formatTrip(trip));
    scheduleCalendarSyncTrip(req.params.id).catch((err) => logger.warn({ err }, "[trips] calendar sync (update) failed"));
    if (isRestoringCancelledTrip && restoredReservations.length > 0) {
      // The reservation status intentionally remains cancelled. This is a
      // best-effort notification path after the trip update has committed.
      for (const reservation of restoredReservations) {
        if (reservation.clientId) {
          dispatchTripRestorationNotification(reservation.id, me.tenantId)
            .catch((err) => req.log.error(
              { err, reservationId: reservation.id },
              "[trips] Error notifying client after trip restoration",
            ));
        }
      }
    }
    // When free-passenger seats change, push an SSE seat-map update so the
    // seat map page and PassengersList auto-refresh without a manual reload.
    // (broadcastSeatUpdate reads tripsTable.freePassengers, so must fire
    //  after the DB write above has committed.)
    if (parsed.data.freePassengers !== undefined) {
      broadcastSeatUpdate(req.params.id, me.tenantId).catch(() => {});
    }
  } catch (err) {
    next(err);
  }
});

router.delete("/trips/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const [existing] = await db.select({ coverImage: tripsTable.coverImage })
      .from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    const media = await db.select({ url: tripMediaTable.url })
      .from(tripMediaTable)
      .where(and(eq(tripMediaTable.tripId, req.params.id), eq(tripMediaTable.tenantId, me.tenantId)));
    await db.delete(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)));
    const cleanupOptions = { checkSameTenantReferences: true };
    if (existing?.coverImage) {
      await deleteOrphanedFile(existing.coverImage, null, req.log, me.tenantId, cleanupOptions);
    }
    // Best-effort: remove all media files after their DB rows are cascaded with
    // the trip, unless another record still references the same file.
    for (const item of media) {
      await deleteOrphanedFile(item.url, null, req.log, me.tenantId, cleanupOptions);
    }
    res.json({ success: true });
    scheduleCalendarDeleteEventsForTrip(req.params.id).catch((err) => logger.warn({ err }, "[trips] calendar delete events failed"));
  } catch (err) {
    next(err);
  }
});

router.get("/trips/:id/seat-map", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const features = await getTenantSupportedFeatures(me.tenantId);
    if (!hasSeatMapFeature(features)) {
      next(new ForbiddenError("Mapa de assentos não está disponível no seu plano atual", "FEATURE_NOT_IN_PLAN"));
      return;
    }
    const [trip] = await db.select().from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Trip not found", "NOT_FOUND")); return; }

    let numberingType = "sequential";
    if (trip.layoutId) {
      const [layout] = await db.select({ numberingType: vehicleLayoutsTable.numberingType })
        .from(vehicleLayoutsTable)
        .where(and(eq(vehicleLayoutsTable.id, trip.layoutId), eq(vehicleLayoutsTable.tenantId, me.tenantId)))
        .limit(1);
      if (layout) numberingType = layout.numberingType;
    }

    const ACTIVE_STATUSES = [RESERVATION_STATUS.PENDING, RESERVATION_STATUS.CONFIRMED];
    const reservations = await db.select().from(reservationsTable)
      .where(and(
        eq(reservationsTable.tripId, req.params.id),
        eq(reservationsTable.tenantId, me.tenantId),
        inArray(reservationsTable.status, ACTIVE_STATUSES),
      ));

    const occupiedSeats: Record<string, { reservationId: string; seatStatus: string }> = {};
    for (const r of reservations) {
      const seatStatus = r.status === RESERVATION_STATUS.CONFIRMED ? "confirmed" : "reserved";
      for (const seat of r.seats) {
        occupiedSeats[seat] = { reservationId: r.id, seatStatus };
      }
    }

    const freePassengers = Array.isArray(trip.freePassengers) ? (trip.freePassengers as FreePassenger[]) : [];
    const freeSeats: Record<string, string> = {};
    for (const fp of freePassengers) {
      if (fp.seatNumber) freeSeats[fp.seatNumber] = fp.name;
    }

    const seatMap = trip.seatMap as Record<string, { row: number; col: number; floor?: number; status: string; type?: string }>;
    const seats = Object.entries(seatMap).map(([num, data]) => ({
      number: num,
      row: data.row,
      col: data.col,
      floor: data.floor ?? 1,
      type: data.type ?? "seat",
      status: occupiedSeats[num]
        ? occupiedSeats[num].seatStatus
        : freeSeats[num]
          ? "free"
          : (data.type && !["seat", "vip", "accessible"].includes(data.type) ? data.type : "available"),
      occupantName: freeSeats[num] ?? null,
      reservationId: occupiedSeats[num]?.reservationId ?? null,
    }));

    const maxCol = Math.max(...seats.map(s => s.col), 4);
    const maxFloor = Math.max(...seats.map(s => s.floor ?? 1), 1);
    res.json({
      tripId: trip.id,
      layout: trip.seatLayout ?? "2x2",
      numberingType,
      floors: maxFloor,
      totalSeats: trip.totalCapacity,
      cols: maxCol,
      seats,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/trips/:id/regenerate-seat-map", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const features = await getTenantSupportedFeatures(me.tenantId);
    if (!hasSeatMapFeature(features)) {
      next(new ForbiddenError("Mapa de assentos não está disponível no seu plano atual", "FEATURE_NOT_IN_PLAN"));
      return;
    }

    const [trip] = await db.select().from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Viagem não encontrada", "TRIP_NOT_FOUND")); return; }
    if (!trip.layoutId) { next(new ValidationError("Esta viagem não tem layout vinculado", "NO_LAYOUT")); return; }

    const [layout] = await db.select().from(vehicleLayoutsTable)
      .where(and(eq(vehicleLayoutsTable.id, trip.layoutId), eq(vehicleLayoutsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!layout) { next(new NotFoundError("Layout não encontrado", "LAYOUT_NOT_FOUND")); return; }

    const cells = (layout.cells ?? []) as LayoutCell[];
    const newSeatMap = generateSeatMapFromLayout(cells, layout.numberingType);

    const seatTypes = ["seat", "vip", "accessible"] as const;

    const posToNewNumber = new Map<string, string>();
    for (const [num, data] of Object.entries(newSeatMap)) {
      if (seatTypes.includes((data.type ?? "seat") as (typeof seatTypes)[number])) {
        posToNewNumber.set(`${data.floor ?? 1}-${data.row}-${data.col}`, num);
      }
    }

    const oldSeatMap = (trip.seatMap ?? {}) as Record<string, SeatMapEntry>;
    const oldNumberToPos = new Map<string, string>();
    for (const [num, data] of Object.entries(oldSeatMap)) {
      oldNumberToPos.set(num, `${data.floor ?? 1}-${data.row}-${data.col}`);
    }

    const activeReservations = await db.select().from(reservationsTable)
      .where(and(
        eq(reservationsTable.tripId, req.params.id),
        eq(reservationsTable.tenantId, me.tenantId),
        inArray(reservationsTable.status, [RESERVATION_STATUS.PENDING, RESERVATION_STATUS.CONFIRMED]),
      ));

    const confirmedReservations = activeReservations.filter(r => r.status === RESERVATION_STATUS.CONFIRMED);
    const pendingReservations = activeReservations.filter(r => r.status === RESERVATION_STATUS.PENDING);

    // Pass 1: process confirmed seats first.
    // Build the set of preserved (old) seat numbers so pending remapping can avoid them.
    const preservedNumbers = new Set<string>();

    for (const r of confirmedReservations) {
      for (const oldNum of r.seats) {
        preservedNumbers.add(oldNum);
        const pos = oldNumberToPos.get(oldNum);
        if (pos) {
          // The new seat map gave this position a new number — remove it to free the slot.
          const newNum = posToNewNumber.get(pos);
          if (newNum && newNum !== oldNum) {
            delete newSeatMap[newNum];
          }
          // Re-insert the confirmed seat under its old number.
          const oldData = oldSeatMap[oldNum];
          if (oldData) {
            newSeatMap[oldNum] = { ...oldData, status: "confirmed" };
          }
        }
      }
    }

    // Pass 2: process pending seats, avoiding collisions with preserved confirmed numbers.
    const pendingUpdates: { id: string; oldSeats: string[]; newSeats: string[] }[] = [];

    for (const r of pendingReservations) {
      const newSeats: string[] = [];
      for (const oldNum of r.seats) {
        const pos = oldNumberToPos.get(oldNum);
        const candidateNew = pos ? (posToNewNumber.get(pos) ?? oldNum) : oldNum;
        // If the candidate number is already reserved by a confirmed seat, fall back to the
        // old number so we don't overwrite the confirmed entry.
        const resolvedNum = preservedNumbers.has(candidateNew) ? oldNum : candidateNew;
        newSeats.push(resolvedNum);

        if (newSeatMap[resolvedNum]) {
          // Entry already in new map (either available or just-deleted-and-now-the-fallback);
          // mark it as reserved only if it's not a confirmed seat.
          if (newSeatMap[resolvedNum].status !== "confirmed") {
            newSeatMap[resolvedNum] = { ...newSeatMap[resolvedNum], status: "reserved" };
          }
        } else {
          // The old number was removed from newSeatMap during confirmed processing
          // (it was the "new number" for a confirmed seat's position). Restore it.
          const oldData = oldSeatMap[resolvedNum];
          if (oldData) {
            newSeatMap[resolvedNum] = { ...oldData, status: "reserved" };
          }
        }
      }
      pendingUpdates.push({ id: r.id, oldSeats: r.seats, newSeats });
    }

    // Integrity guard: ensure no seat number appears in more than one active reservation.
    const allActiveSeats = new Map<string, string>(); // seat -> reservationId
    for (const r of confirmedReservations) {
      for (const s of r.seats) {
        if (allActiveSeats.has(s)) {
          next(new AppError(`Assento ${s} está em múltiplas reservas — resolva os conflitos antes de renumerar`, 409, "SEAT_COLLISION"));
          return;
        }
        allActiveSeats.set(s, r.id);
      }
    }
    for (const { id, newSeats } of pendingUpdates) {
      for (const s of newSeats) {
        if (allActiveSeats.has(s)) {
          next(new AppError(`Assento ${s} está em múltiplas reservas — resolva os conflitos antes de renumerar`, 409, "SEAT_COLLISION"));
          return;
        }
        allActiveSeats.set(s, id);
      }
    }

    // Dry-run: return the diff without committing.
    if (req.query.dryRun === "true") {
      const changes: { oldNumber: string; newNumber: string }[] = [];
      for (const { oldSeats, newSeats } of pendingUpdates) {
        for (let i = 0; i < oldSeats.length; i++) {
          const oldNum = oldSeats[i];
          const newNum = newSeats[i];
          if (oldNum !== newNum) {
            changes.push({ oldNumber: oldNum, newNumber: newNum ?? oldNum });
          }
        }
      }
      const preserved: string[] = [];
      for (const r of confirmedReservations) {
        for (const s of r.seats) {
          preserved.push(s);
        }
      }
      res.json({ changes, preserved });
      return;
    }

    // Commit all changes atomically.
    await db.transaction(async (tx) => {
      for (const { id, oldSeats, newSeats } of pendingUpdates) {
        if (JSON.stringify(newSeats) !== JSON.stringify(oldSeats)) {
          await tx.update(reservationsTable)
            .set({ seats: newSeats })
            .where(eq(reservationsTable.id, id));
        }
      }
      await tx.update(tripsTable)
        .set({ seatMap: newSeatMap })
        .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)));
    });

    const seatsChangedCount = pendingUpdates.reduce((acc, { oldSeats, newSeats }) => {
      return acc + oldSeats.filter((s, i) => s !== newSeats[i]).length;
    }, 0);

    await db.insert(auditLogsTable).values({
      id: generateId(),
      tenantId: me.tenantId,
      userId: me.id,
      action: "regenerate_seat_map",
      entityType: "trip",
      entityId: req.params.id,
      after: {
        reservationsRenumbered: pendingUpdates.filter(({ oldSeats, newSeats }) => JSON.stringify(oldSeats) !== JSON.stringify(newSeats)).length,
        seatsChanged: seatsChangedCount,
        layoutId: trip.layoutId,
      },
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
    });

    const [updatedTrip] = await db.select().from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!updatedTrip) { next(new AppError("Falha ao buscar viagem atualizada", 500, "TRIP_FETCH_FAILED")); return; }

    res.json(formatTrip(updatedTrip));
  } catch (err) {
    next(err);
  }
});

router.post("/trips/:id/sync-seat-counters", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Apenas administradores podem sincronizar contadores", "FORBIDDEN_ROLE")); return; }

    const [trip] = await db.select().from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Viagem n\u00e3o encontrada", "TRIP_NOT_FOUND")); return; }

    const activeReservations = await db.select({ status: reservationsTable.status, seats: reservationsTable.seats })
      .from(reservationsTable)
      .where(and(
        eq(reservationsTable.tripId, req.params.id),
        eq(reservationsTable.tenantId, me.tenantId),
        inArray(reservationsTable.status, [RESERVATION_STATUS.PENDING, RESERVATION_STATUS.CONFIRMED]),
      ));

    let reservedSeats = 0;
    let confirmedSeats = 0;
    for (const r of activeReservations) {
      const seatCount = (r.seats ?? []).length;
      if (r.status === RESERVATION_STATUS.CONFIRMED) confirmedSeats += seatCount;
      else reservedSeats += seatCount;
    }
    const fpCount = Array.isArray(trip.freePassengers) ? (trip.freePassengers as FreePassenger[]).length : 0;
    const totalCapacity = Number(trip.totalCapacity) || 0;
    const availableSeats = Math.max(0, totalCapacity - reservedSeats - confirmedSeats - fpCount);

    await db.update(tripsTable).set({
      reservedSeats,
      confirmedSeats,
      availableSeats,
    }).where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)));

    await db.insert(auditLogsTable).values({
      id: generateId(),
      tenantId: me.tenantId,
      userId: me.id,
      action: "sync_seat_counters",
      entityType: "trip",
      entityId: req.params.id,
      after: { reservedSeats, confirmedSeats, availableSeats, totalCapacity, freePassengers: fpCount },
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
    });

    const [refreshed] = await db.select().from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!refreshed) { next(new AppError("Falha ao buscar viagem atualizada", 500, "TRIP_FETCH_FAILED")); return; }
    res.json(formatTrip(refreshed));
  } catch (err) {
    next(err);
  }
});

router.get("/trips/:id/seats/stream", async (req, res, next: NextFunction): Promise<void> => {
  const me = await requireAuth(req, res);
  if (!me) return;

  const features = await getTenantSupportedFeatures(me.tenantId);
  if (!hasSeatMapFeature(features)) {
    next(new ForbiddenError("Mapa de assentos não está disponível no seu plano atual", "FEATURE_NOT_IN_PLAN"));
    return;
  }

  const [trip] = await db.select({ id: tripsTable.id })
    .from(tripsTable)
    .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
    .limit(1);
  if (!trip) { next(new NotFoundError("Trip not found", "NOT_FOUND")); return; }

  const tripId = trip.id;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  addSeatClient(tripId, res);
  const ping = setInterval(() => {
    try { res.write(": ping\n\n"); } catch { clearInterval(ping); }
  }, 30000);
  req.on("close", () => {
    clearInterval(ping);
    removeSeatClient(tripId, res);
  });
});

router.get("/trips/:id/boarding-panel", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [trip] = await db.select().from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Trip not found", "NOT_FOUND")); return; }

    let numberingType = "sequential";
    if (trip.layoutId) {
      const [layout] = await db.select({ numberingType: vehicleLayoutsTable.numberingType })
        .from(vehicleLayoutsTable)
        .where(and(eq(vehicleLayoutsTable.id, trip.layoutId), eq(vehicleLayoutsTable.tenantId, me.tenantId)))
        .limit(1);
      if (layout) numberingType = layout.numberingType;
    }

    if (!trip.manifestNumber) {
      const year = trip.departureDate.getFullYear();
      let assigned: string | null | undefined = null;
      for (let attempt = 0; attempt < 5 && !assigned; attempt++) {
        const [countRow] = await db.select({ count: sql<number>`count(*)` })
          .from(tripsTable)
          .where(and(
            eq(tripsTable.tenantId, me.tenantId),
            sql`manifest_number IS NOT NULL`,
            sql`EXTRACT(YEAR FROM departure_date) = ${year}`,
          ));
        const seq = (Number(countRow?.count ?? 0) + 1 + attempt).toString().padStart(6, "0");
        const candidate = `MAN-${year}-${seq}`;
        try {
          await db.update(tripsTable).set({ manifestNumber: candidate })
            .where(and(
              eq(tripsTable.id, trip.id),
              eq(tripsTable.tenantId, me.tenantId),
              sql`manifest_number IS NULL`,
            ));
        } catch {
          continue;
        }
        const [refreshed] = await db.select({ manifestNumber: tripsTable.manifestNumber })
          .from(tripsTable)
          .where(and(eq(tripsTable.id, trip.id), eq(tripsTable.tenantId, me.tenantId)))
          .limit(1);
        assigned = refreshed?.manifestNumber;
      }
      if (!assigned) {
        const [final] = await db.select({ manifestNumber: tripsTable.manifestNumber })
          .from(tripsTable)
          .where(and(eq(tripsTable.id, trip.id), eq(tripsTable.tenantId, me.tenantId)))
          .limit(1);
        assigned = final?.manifestNumber;
      }
      if (!assigned) {
        req.log.error({ tripId: trip.id }, "Failed to assign manifest number after 5 attempts");
        next(new AppError("Não foi possível gerar o número do manifesto. Tente novamente.", 500, "MANIFEST_NUMBER_FAILED"));
        return;
      }
      trip.manifestNumber = assigned;
    }

    const reservations = await db.select().from(reservationsTable)
      .where(and(
        eq(reservationsTable.tripId, trip.id),
        eq(reservationsTable.tenantId, me.tenantId),
        sql`${reservationsTable.status} NOT IN (${RESERVATION_STATUS.CANCELLED}, ${RESERVATION_STATUS.REFUNDED})`,
      ));

    if (reservations.length === 0) {
      const [tenantEarly] = await db.select({ name: tenantsTable.name, cnpj: tenantsTable.cnpj }).from(tenantsTable).where(eq(tenantsTable.id, me.tenantId)).limit(1);
      const earlyFreePassengers = Array.isArray(trip.freePassengers) ? (trip.freePassengers as FreePassenger[]) : [];
      const earlyFreeCheckedIn = earlyFreePassengers.filter(fp => !!fp.checkedInAt).length;
      res.json({
        tripId: trip.id,
        tripName: trip.name,
        departureDate: trip.departureDate.toISOString(),
        totalPassengers: earlyFreePassengers.length,
        checkedIn: earlyFreeCheckedIn,
        passengers: [],
        freePassengers: earlyFreePassengers,
        tenantName: tenantEarly?.name ?? "",
        tenantCnpj: tenantEarly?.cnpj ?? null,
        numberingType,
        boardingPoints: (trip.boardingPoints ?? []) as Array<{ id: string; name: string; time?: string; address?: string }>,
        manifestNumber: trip.manifestNumber ?? null,
        vehiclePlate: trip.vehiclePlate ?? null,
        vehicleType: trip.vehicleType ?? null,
        driverName: trip.driverName ?? null,
        driver1Cpf: trip.driver1Cpf ?? null,
        driver1Cnh: trip.driver1Cnh ?? null,
        driver1CnhCategory: trip.driver1CnhCategory ?? null,
        driver1CnhExpiry: trip.driver1CnhExpiry ?? null,
        driver2Name: trip.driver2Name ?? null,
        driver2Cpf: trip.driver2Cpf ?? null,
        driver2Cnh: trip.driver2Cnh ?? null,
        driver2CnhCategory: trip.driver2CnhCategory ?? null,
        driver2CnhExpiry: trip.driver2CnhExpiry ?? null,
        tourGuide: trip.tourGuide ?? null,
        tourGuideCpf: trip.tourGuideCpf ?? null,
        tourGuideRegistration: trip.tourGuideRegistration ?? null,
      });
      return;
    }

    const reservationIds = reservations.map(r => r.id);
    const clientIds = [...new Set(reservations.map(r => r.clientId).filter((id): id is string => id !== null))];

    const [passengers, clients, [tenant], boardingLocations] = await Promise.all([
      db.select().from(passengersTable).where(inArray(passengersTable.reservationId, reservationIds)),
      db.select({ id: clientsTable.id, name: clientsTable.name, phone: clientsTable.phone, whatsapp: clientsTable.whatsapp }).from(clientsTable).where(inArray(clientsTable.id, clientIds)),
      db.select({ name: tenantsTable.name, cnpj: tenantsTable.cnpj }).from(tenantsTable).where(eq(tenantsTable.id, me.tenantId)).limit(1),
      db.select({ id: boardingLocationsTable.id, name: boardingLocationsTable.name, address: boardingLocationsTable.address, departureTime: boardingLocationsTable.departureTime }).from(boardingLocationsTable).where(eq(boardingLocationsTable.tenantId, me.tenantId)),
    ]);

    const reservationMap = new Map(reservations.map(r => [r.id, r]));
    const clientMap = new Map(clients.map(c => [c.id, c]));

    const boardingPassengers = passengers.map(p => {
      const reservation = reservationMap.get(p.reservationId);
      const client = reservation?.clientId ? clientMap.get(reservation.clientId) : undefined;
      const effectiveBoardingLocationId = p.boardingLocationId ?? reservation?.boardingLocationId ?? null;
      return {
        id: p.id,
        reservationId: p.reservationId,
        voucherCode: reservation?.voucherCode ?? "",
        reservationNumber: reservation?.reservationNumber ?? null,
        clientName: client?.name ?? "—",
        name: p.name,
        cpf: p.cpf ?? null,
        seatNumber: p.seatNumber ?? null,
        ageCategory: p.ageCategory,
        checkedInAt: p.checkedInAt?.toISOString() ?? null,
        birthDate: p.birthDate?.toISOString() ?? null,
        phone: client?.phone ?? null,
        whatsapp: client?.whatsapp ?? null,
        boardingLocationId: effectiveBoardingLocationId,
        disembarkLocationId: p.disembarkLocationId ?? null,
        passengerPhone: p.phone ?? null,
        observations: p.observations ?? null,
        specialNeeds: p.specialNeeds ?? null,
        documentType: p.documentType ?? null,
        isGratuidade: reservation?.isGratuidade ?? false,
        totalValue: reservation?.totalValue ?? null,
        paidValue: reservation?.paidValue ?? null,
        balance: reservation?.balance ?? null,
      };
    });

    const checkedIn = boardingPassengers.filter(p => p.checkedInAt !== null).length;
    const tripFreePassengers = Array.isArray(trip.freePassengers) ? (trip.freePassengers as FreePassenger[]) : [];
    const freeCheckedIn = tripFreePassengers.filter(fp => !!fp.checkedInAt).length;

    res.json({
      tripId: trip.id,
      tripName: trip.name,
      departureDate: trip.departureDate.toISOString(),
      totalPassengers: boardingPassengers.length + tripFreePassengers.length,
      checkedIn: checkedIn + freeCheckedIn,
      passengers: boardingPassengers,
      freePassengers: tripFreePassengers,
      tenantName: tenant?.name ?? "",
      tenantCnpj: tenant?.cnpj ?? null,
      numberingType,
      boardingPoints: [
        ...(trip.boardingPoints ?? []) as Array<{ id: string; name: string; time?: string; address?: string }>,
        ...boardingLocations.map(bl => ({ id: bl.id, name: bl.name, time: bl.departureTime ?? undefined, address: bl.address })),
      ],
      manifestNumber: trip.manifestNumber ?? null,
      vehiclePlate: trip.vehiclePlate ?? null,
      vehicleType: trip.vehicleType ?? null,
      driverName: trip.driverName ?? null,
      driver1Cpf: trip.driver1Cpf ?? null,
      driver1Cnh: trip.driver1Cnh ?? null,
      driver1CnhCategory: trip.driver1CnhCategory ?? null,
      driver1CnhExpiry: trip.driver1CnhExpiry ?? null,
      driver2Name: trip.driver2Name ?? null,
      driver2Cpf: trip.driver2Cpf ?? null,
      driver2Cnh: trip.driver2Cnh ?? null,
      driver2CnhCategory: trip.driver2CnhCategory ?? null,
      driver2CnhExpiry: trip.driver2CnhExpiry ?? null,
      tourGuide: trip.tourGuide ?? null,
      tourGuideCpf: trip.tourGuideCpf ?? null,
      tourGuideRegistration: trip.tourGuideRegistration ?? null,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/trips/:id/free-passengers/:fpId/check-in", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [trip] = await db.select().from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Trip not found", "NOT_FOUND")); return; }

    const fps: FreePassenger[] = Array.isArray(trip.freePassengers) ? (trip.freePassengers as FreePassenger[]) : [];
    const idx = fps.findIndex(fp => fp.id === req.params.fpId);
    if (idx === -1) { next(new NotFoundError("Free passenger not found", "NOT_FOUND")); return; }

    const now = new Date().toISOString();
    fps[idx] = { ...fps[idx], checkedInAt: now };
    await db.update(tripsTable).set({ freePassengers: fps }).where(eq(tripsTable.id, trip.id));

    res.json({ id: fps[idx].id, checkedInAt: now });
  } catch (err) {
    next(err);
  }
});

router.delete("/trips/:id/free-passengers/:fpId/check-in", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [trip] = await db.select().from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Trip not found", "NOT_FOUND")); return; }

    const fps: FreePassenger[] = Array.isArray(trip.freePassengers) ? (trip.freePassengers as FreePassenger[]) : [];
    const idx = fps.findIndex(fp => fp.id === req.params.fpId);
    if (idx === -1) { next(new NotFoundError("Free passenger not found", "NOT_FOUND")); return; }

    fps[idx] = { ...fps[idx], checkedInAt: null };
    await db.update(tripsTable).set({ freePassengers: fps }).where(eq(tripsTable.id, trip.id));

    res.json({ id: fps[idx].id, checkedInAt: null });
  } catch (err) {
    next(err);
  }
});

router.get("/trips/:id/passengers/export", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [trip] = await db.select().from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Trip not found", "NOT_FOUND")); return; }

    const [exportLayoutRow] = trip.layoutId
      ? await db.select({ numberingType: vehicleLayoutsTable.numberingType })
          .from(vehicleLayoutsTable)
          .where(eq(vehicleLayoutsTable.id, trip.layoutId))
          .limit(1)
      : [undefined];
    const exportNumberingType = exportLayoutRow?.numberingType ?? null;

    const statusParam = req.query.status as string | undefined;
    const validStatuses: string[] = [...Object.values(RESERVATION_STATUS), "all"];
    if (statusParam && !validStatuses.includes(statusParam)) {
      next(new ValidationError(`Status inválido: "${statusParam}". Valores permitidos: ${validStatuses.join(", ")}`, "INVALID_STATUS"));
      return;
    }
    const filterStatus = statusParam ?? null;

    const reservations = await db.select().from(reservationsTable)
      .where(
        filterStatus === "all"
          ? and(eq(reservationsTable.tripId, trip.id), eq(reservationsTable.tenantId, me.tenantId))
          : filterStatus
            ? and(
                eq(reservationsTable.tripId, trip.id),
                eq(reservationsTable.tenantId, me.tenantId),
                eq(reservationsTable.status, filterStatus as ReservationStatus),
              )
            : and(
                eq(reservationsTable.tripId, trip.id),
                eq(reservationsTable.tenantId, me.tenantId),
                sql`${reservationsTable.status} NOT IN (${RESERVATION_STATUS.CANCELLED}, ${RESERVATION_STATUS.REFUNDED})`,
              ),
      );

    const boardingPoints: Array<{ id: string; name: string; time?: string }> =
      Array.isArray(trip.boardingPoints) ? (trip.boardingPoints as Array<{ id: string; name: string; time?: string }>) : [];
    const bpMap = new Map(boardingPoints.map(bp => [bp.id, bp.name]));

    const boardingLocations = await db.select({ id: boardingLocationsTable.id, name: boardingLocationsTable.name })
      .from(boardingLocationsTable)
      .where(eq(boardingLocationsTable.tenantId, me.tenantId));
    const blMap = new Map(boardingLocations.map(bl => [bl.id, bl.name]));

    const AGE_LABELS: Record<string, string> = {
      adult: "Adulto",
      child: "Criança",
      senior: "Idoso",
      infant: "Bebê",
    };

    let rows: string[][] = [];
    if (reservations.length > 0) {
      const reservationIds = reservations.map(r => r.id);
      const passengers = await db.select().from(passengersTable)
        .where(inArray(passengersTable.reservationId, reservationIds));

      const reservationMap = new Map(reservations.map(r => [r.id, r]));
      const emittedReservationIds = new Set<string>();

      rows = passengers.map(p => {
        const reservation = reservationMap.get(p.reservationId);
        const effectiveBoardingLocationId = p.boardingLocationId ?? reservation?.boardingLocationId ?? null;
        const boardingName = effectiveBoardingLocationId ? (bpMap.get(effectiveBoardingLocationId) ?? blMap.get(effectiveBoardingLocationId) ?? effectiveBoardingLocationId) : "";
        const birthDateStr = p.birthDate ? p.birthDate.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "";
        const checkInStr = p.checkedInAt ? "Sim" : "Não";
        const totalValue = Number(reservation?.totalValue ?? 0);
        const discount = Number(reservation?.discountTotal ?? 0);
        const financialValues = reservation
          ? getPassengerExportFinancialValues(reservation.id, totalValue, discount, emittedReservationIds)
          : ["0.00", "0.00", "0.00"] as [string, string, string];
        return [
          p.name,
          reservation?.reservationNumber ?? reservation?.voucherCode ?? "",
          p.cpf ?? "",
          p.rg ?? "",
          birthDateStr,
          AGE_LABELS[p.ageCategory] ?? p.ageCategory,
          seatWithPosition(p.seatNumber ?? null, exportNumberingType),
          boardingName,
          checkInStr,
          "",
          ...financialValues,
        ];
      });
    }

    const freePassengersData = Array.isArray(trip.freePassengers) ? (trip.freePassengers as FreePassenger[]) : [];
    const freeRoleLabel: Record<string, string> = { organizer: "Organizador", guide: "Guia de Turismo" };
    const freeRows: string[][] = freePassengersData.map(fp => [
      fp.name,
      "",
      fp.cpf ?? "",
      "",
      "",
      "Gratuidade",
      seatWithPosition(fp.seatNumber ?? null, exportNumberingType),
      "",
      "—",
      freeRoleLabel[fp.role] ?? fp.role,
      "0.00",
      "0.00",
      "0.00",
    ]);

    const header = [
      "Passageiro", "Nº Reserva", "CPF", "RG", "Data Nasc.", "Categoria", "Assento",
      "Local de Embarque", "Check-in", "Função", "Valor Total", "Valor Base", "Desconto",
    ];
    const csvLines = [header, ...rows, ...freeRows].map(r =>
      r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")
    );
    const csvContent = "\uFEFF" + csvLines.join("\n");

    const safeName = trip.name.replace(/[^a-zA-Z0-9\-_]/g, "_");
    const dateStr = format(new Date(), "yyyy-MM-dd");
    const statusLabelMap: Record<string, string> = {
      confirmed: "confirmados",
      pending: "pendentes",
      completed: "concluidos",
      cancelled: "cancelados",
      all: "todos",
    };
    const statusLabel = filterStatus ? (statusLabelMap[filterStatus] ?? filterStatus) : "ativos";
    const filename = `passageiros-${safeName}-${statusLabel}-${dateStr}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csvContent);
  } catch (err) {
    next(err);
  }
});

router.post("/trips/:id/sync-passengers", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [trip] = await db.select({ id: tripsTable.id })
      .from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Trip not found", "NOT_FOUND")); return; }

    const reservations = await db.select().from(reservationsTable)
      .where(and(
        eq(reservationsTable.tripId, trip.id),
        eq(reservationsTable.tenantId, me.tenantId),
        sql`${reservationsTable.status} NOT IN (${RESERVATION_STATUS.CANCELLED}, ${RESERVATION_STATUS.REFUNDED})`,
      ));

    if (reservations.length === 0) {
      res.json({ created: 0 });
      return;
    }

    const reservationIds = reservations.map(r => r.id);
    const existingPassengers = await db.select({ reservationId: passengersTable.reservationId })
      .from(passengersTable)
      .where(inArray(passengersTable.reservationId, reservationIds));
    const reservationIdsWithPassengers = new Set(existingPassengers.map(p => p.reservationId));

    const reservationsNeedingPassenger = reservations.filter(r => !reservationIdsWithPassengers.has(r.id));

    if (reservationsNeedingPassenger.length === 0) {
      res.json({ created: 0 });
      return;
    }

    const clientIds = [...new Set(reservationsNeedingPassenger.map(r => r.clientId).filter((id): id is string => id !== null))];
    const clients = await db.select().from(clientsTable)
      .where(inArray(clientsTable.id, clientIds));
    const clientMap = new Map(clients.map(c => [c.id, c]));

    let created = 0;
    for (const r of reservationsNeedingPassenger) {
      const client = r.clientId ? clientMap.get(r.clientId) : undefined;
      if (!client) continue;
      const inserted = await db.insert(passengersTable).values({
        id: generateId(),
        reservationId: r.id,
        name: client.name,
        cpf: client.cpf ?? null,
        rg: client.rg ?? null,
        birthDate: client.birthDate ?? null,
        ...(() => {
          const cat = deriveAgeCategory(client.birthDate ?? null);
          return { ageCategory: cat, isChildUnder7: syncIsChildUnder7(cat) };
        })(),
        seatNumber: r.seats?.[0] ?? null,
        isPrimary: true,
        boardingLocationId: r.boardingLocationId ?? null,
      }).onConflictDoNothing().returning({ id: passengersTable.id });
      if (inserted.length > 0) created++;
    }

    res.json({ created });
  } catch (err) {
    next(err);
  }
});

const UpdatePassengerBody = z.object({
  boardingLocationId: z.string().nullish(),
  disembarkLocationId: z.string().nullish(),
  passengerPhone: z.string().nullish(),
  observations: z.string().nullish(),
  specialNeeds: z.string().nullish(),
  documentType: z.string().nullish(),
});

router.patch("/trips/:tripId/passengers/:passengerId", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const { tripId, passengerId } = req.params;
    const parsedBody = UpdatePassengerBody.safeParse(req.body);
    if (!parsedBody.success) {
      next(new ValidationError(parsedBody.error.issues[0]?.message ?? "Dados inválidos", "VALIDATION_ERROR")); return;
    }
    const { boardingLocationId, disembarkLocationId, passengerPhone, observations, specialNeeds, documentType } = parsedBody.data;

    const [trip] = await db.select({ id: tripsTable.id, boardingPoints: tripsTable.boardingPoints })
      .from(tripsTable)
      .where(and(eq(tripsTable.id, tripId), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Trip not found", "NOT_FOUND")); return; }

    const [passenger] = await db.select({ id: passengersTable.id, reservationId: passengersTable.reservationId })
      .from(passengersTable)
      .where(eq(passengersTable.id, passengerId))
      .limit(1);
    if (!passenger) { next(new NotFoundError("Passenger not found", "NOT_FOUND")); return; }

    const [reservation] = await db.select({ tripId: reservationsTable.tripId })
      .from(reservationsTable)
      .where(and(eq(reservationsTable.id, passenger.reservationId), eq(reservationsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!reservation || reservation.tripId !== trip.id) { next(new NotFoundError("Passenger not found", "NOT_FOUND")); return; }

    if (boardingLocationId === undefined && disembarkLocationId === undefined &&
        passengerPhone === undefined && observations === undefined &&
        specialNeeds === undefined && documentType === undefined) {
      next(new AppError("At least one field must be provided", 422, "VALIDATION_ERROR"));
      return;
    }

    const VALID_DOCUMENT_TYPES = ["RG", "CNH", "PASSAPORTE", "Certidão de Nascimento"];
    if (documentType !== undefined && documentType !== null && !VALID_DOCUMENT_TYPES.includes(documentType)) {
      next(new AppError(`Invalid documentType. Must be one of: ${VALID_DOCUMENT_TYPES.join(", ")}`, 422, "VALIDATION_ERROR")); return;
    }

    const boardingPointIds = new Set(
      ((trip.boardingPoints ?? []) as Array<{ id: string }>).map(bp => bp.id)
    );

    if (boardingLocationId !== undefined && boardingLocationId !== null && !boardingPointIds.has(boardingLocationId)) {
      next(new AppError("Invalid boardingLocationId: not in trip boarding points", 422, "VALIDATION_ERROR"));
      return;
    }
    if (disembarkLocationId !== undefined && disembarkLocationId !== null && !boardingPointIds.has(disembarkLocationId)) {
      next(new AppError("Invalid disembarkLocationId: not in trip boarding points", 422, "VALIDATION_ERROR"));
      return;
    }

    const updateData: Partial<typeof passengersTable.$inferSelect> = {};
    if (boardingLocationId !== undefined) updateData.boardingLocationId = boardingLocationId;
    if (disembarkLocationId !== undefined) updateData.disembarkLocationId = disembarkLocationId;
    if (passengerPhone !== undefined) updateData.phone = passengerPhone;
    if (observations !== undefined) updateData.observations = observations;
    if (specialNeeds !== undefined) updateData.specialNeeds = specialNeeds;
    if (documentType !== undefined) updateData.documentType = documentType;

    const [updated] = await db.update(passengersTable)
      .set(updateData)
      .where(eq(passengersTable.id, passengerId))
      .returning();

    res.json({
      id: updated.id,
      boardingLocationId: updated.boardingLocationId ?? null,
      disembarkLocationId: updated.disembarkLocationId ?? null,
      passengerPhone: updated.phone ?? null,
      observations: updated.observations ?? null,
      specialNeeds: updated.specialNeeds ?? null,
      documentType: updated.documentType ?? null,
    });
  } catch (err) {
    next(err);
  }
});


const SendManifestBody = z.discriminatedUnion("channel", [
  z.object({ channel: z.literal("email"), to: z.string().email("Endereço de e-mail inválido") }),
  z.object({ channel: z.literal("whatsapp"), to: z.string().min(8, "Número de WhatsApp muito curto").max(20, "Número de WhatsApp muito longo").regex(/^[\d\s\(\)\-\+]+$/, "Número de WhatsApp inválido") }),
]);

router.post("/trips/:id/manifest/send", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const parsed = SendManifestBody.safeParse(req.body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      next(new ValidationError(firstIssue?.message ?? "Dados inválidos", "VALIDATION_ERROR")); return;
    }
    const { channel, to } = parsed.data;

    const [trip] = await db.select().from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Excursão não encontrada", "NOT_FOUND")); return; }

    const reservations = await db.select().from(reservationsTable)
      .where(and(
        eq(reservationsTable.tripId, trip.id),
        eq(reservationsTable.tenantId, me.tenantId),
        sql`${reservationsTable.status} NOT IN (${RESERVATION_STATUS.CANCELLED}, ${RESERVATION_STATUS.REFUNDED})`,
      ));

    const reservationIds = reservations.map(r => r.id);

    const [passengers, [tenant], [layoutRow]] = await Promise.all([
      reservationIds.length > 0
        ? db.select().from(passengersTable).where(inArray(passengersTable.reservationId, reservationIds))
        : Promise.resolve([]),
      db.select({ name: tenantsTable.name, cnpj: tenantsTable.cnpj }).from(tenantsTable).where(eq(tenantsTable.id, me.tenantId)).limit(1),
      trip.layoutId
        ? db.select({ numberingType: vehicleLayoutsTable.numberingType }).from(vehicleLayoutsTable).where(eq(vehicleLayoutsTable.id, trip.layoutId)).limit(1)
        : Promise.resolve([undefined]),
    ]);

    const reservationMap = new Map(reservations.map(r => [r.id, r]));

    const manifestPassengers: ManifestPassenger[] = passengers.map(p => {
      const reservation = reservationMap.get(p.reservationId);
      const effectiveBoardingLocationId = p.boardingLocationId ?? reservation?.boardingLocationId ?? null;
      return {
        name: p.name,
        cpf: p.cpf ?? null,
        birthDate: p.birthDate?.toISOString() ?? null,
        ageCategory: p.ageCategory,
        seatNumber: p.seatNumber ?? null,
        boardingLocationId: effectiveBoardingLocationId,
        documentType: p.documentType ?? null,
        specialNeeds: p.specialNeeds ?? null,
        observations: p.observations ?? null,
      };
    });

    const panel: ManifestPanel = {
      tripName: trip.name,
      departureDate: trip.departureDate.toISOString(),
      departureTime: trip.departureTime ?? null,
      tenantName: tenant?.name ?? "",
      tenantCnpj: tenant?.cnpj ?? null,
      manifestNumber: trip.manifestNumber ?? null,
      vehiclePlate: trip.vehiclePlate ?? null,
      vehicleType: trip.vehicleType ?? null,
      driverName: trip.driverName ?? null,
      driver1Cpf: trip.driver1Cpf ?? null,
      driver1Cnh: trip.driver1Cnh ?? null,
      driver1CnhCategory: trip.driver1CnhCategory ?? null,
      driver1CnhExpiry: trip.driver1CnhExpiry ?? null,
      driver2Name: trip.driver2Name ?? null,
      driver2Cpf: trip.driver2Cpf ?? null,
      driver2Cnh: trip.driver2Cnh ?? null,
      driver2CnhCategory: trip.driver2CnhCategory ?? null,
      driver2CnhExpiry: trip.driver2CnhExpiry ?? null,
      tourGuide: trip.tourGuide ?? null,
      tourGuideCpf: trip.tourGuideCpf ?? null,
      tourGuideRegistration: trip.tourGuideRegistration ?? null,
      boardingPoints: (trip.boardingPoints ?? []) as Array<{ id: string; name: string; time?: string }>,
      passengers: manifestPassengers,
      freePassengers: Array.isArray(trip.freePassengers) ? (trip.freePassengers as FreePassenger[]) : [],
      destinationCity: trip.destinationCity,
      destinationState: trip.destinationState,
      numberingType: layoutRow?.numberingType ?? null,
    };

    const auditMeta: Record<string, string> = { channel, to: channel === "whatsapp" ? to : to.replace(/(.{2}).+(@.+)/, "$1***$2") };

    if (channel === "email") {
      const pdfQueue = getPdfQueue();
      if (pdfQueue) {
        await pdfQueue.add("manifest", {
          type: "manifest",
          tenantId: me.tenantId,
          tripId: trip.id,
          recipientEmail: to,
          userId: me.id,
          ipAddress: getClientIp(req),
          userAgent: req.headers["user-agent"] ?? null,
        });
        res.status(202).json({ success: true, channel: "email", queued: true });
        return;
      }

      if (!areWorkersEnabled()) {
        logger.warn(
          { jobType: "pdf-manifest", tenantId: me.tenantId, tripId: trip.id },
          "[workers-disabled] ENABLE_WORKERS=false — sending manifest PDF directly instead of queuing. Set ENABLE_WORKERS=true to enable async processing.",
        );
      }

      const [html, pdfBuffer] = await Promise.all([
        Promise.resolve(generateManifestHtml(panel)),
        generateManifestPdf(panel),
      ]);

      const result = await sendManifestEmail({
        to,
        tripName: trip.name,
        manifestNumber: trip.manifestNumber ?? null,
        agencyName: tenant?.name ?? "VisiteCRM",
        htmlContent: html,
        pdfAttachment: pdfBuffer,
      });

      if (!result.success) {
        req.log.error({ error: result.error }, "Failed to send manifest email");
        next(new AppError(result.error ?? "Falha ao enviar e-mail", 500, "MANIFEST_EMAIL_FAILED"));
        return;
      }

      await db.insert(auditLogsTable).values({
        id: generateId(),
        tenantId: me.tenantId,
        userId: me.id,
        action: "manifest_sent",
        entityType: "trip",
        entityId: trip.id,
        after: auditMeta,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      res.json({ success: true, channel: "email" });
    } else {
      const depDate = trip.departureDate ? format(trip.departureDate, "dd/MM/yyyy", { locale: ptBR }) : "";
      const proto = req.headers["x-forwarded-proto"] ?? "https";
      const host = req.headers["x-forwarded-host"] ?? req.get("host") ?? "";
      const manifestLink = `${proto}://${host}/trips/${trip.id}/passengers`;

      const messageParts = [
        `📋 *Manifesto ANTT — ${trip.name}*`,
        trip.manifestNumber ? `Nº Manifesto: ${trip.manifestNumber}` : null,
        panel.destinationCity ? `Destino: ${panel.destinationCity}${panel.destinationState ? `/${panel.destinationState}` : ""}` : null,
        depDate ? `Saída: ${depDate}` : null,
        `Total de passageiros: ${manifestPassengers.length + panel.freePassengers.length}`,
        ``,
        `🔗 Acesso ao manifesto: ${manifestLink}`,
        ``,
        `_Emitido via VisiteCRM_`,
      ].filter((l): l is string => l !== null).join("\n");

      const digits = to.replace(/\D/g, "");
      const phone = digits.startsWith("55") ? digits : `55${digits}`;
      const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(messageParts)}`;

      await db.insert(auditLogsTable).values({
        id: generateId(),
        tenantId: me.tenantId,
        userId: me.id,
        action: "manifest_sent",
        entityType: "trip",
        entityId: trip.id,
        after: auditMeta,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      res.json({ success: true, channel: "whatsapp", whatsappUrl });
    }
  } catch (err) {
    next(err);
  }
});

router.get("/trips/:id/manifest/pdf", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [trip] = await db.select().from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Excursão não encontrada", "NOT_FOUND")); return; }

    const reservations = await db.select().from(reservationsTable)
      .where(and(
        eq(reservationsTable.tripId, trip.id),
        eq(reservationsTable.tenantId, me.tenantId),
        sql`${reservationsTable.status} NOT IN (${RESERVATION_STATUS.CANCELLED}, ${RESERVATION_STATUS.REFUNDED})`,
      ));

    const reservationIds = reservations.map(r => r.id);

    const [passengers, [tenant], [layoutRow]] = await Promise.all([
      reservationIds.length > 0
        ? db.select().from(passengersTable).where(inArray(passengersTable.reservationId, reservationIds))
        : Promise.resolve([]),
      db.select({ name: tenantsTable.name, cnpj: tenantsTable.cnpj }).from(tenantsTable).where(eq(tenantsTable.id, me.tenantId)).limit(1),
      trip.layoutId
        ? db.select({ numberingType: vehicleLayoutsTable.numberingType }).from(vehicleLayoutsTable).where(eq(vehicleLayoutsTable.id, trip.layoutId)).limit(1)
        : Promise.resolve([undefined]),
    ]);

    const reservationMap = new Map(reservations.map(r => [r.id, r]));

    const manifestPassengers: ManifestPassenger[] = passengers.map(p => {
      const reservation = reservationMap.get(p.reservationId);
      const effectiveBoardingLocationId = p.boardingLocationId ?? reservation?.boardingLocationId ?? null;
      return {
        name: p.name,
        cpf: p.cpf ?? null,
        birthDate: p.birthDate?.toISOString() ?? null,
        ageCategory: p.ageCategory,
        seatNumber: p.seatNumber ?? null,
        boardingLocationId: effectiveBoardingLocationId,
        documentType: p.documentType ?? null,
        specialNeeds: p.specialNeeds ?? null,
        observations: p.observations ?? null,
      };
    });

    const panel: ManifestPanel = {
      tripName: trip.name,
      departureDate: trip.departureDate.toISOString(),
      departureTime: trip.departureTime ?? null,
      tenantName: tenant?.name ?? "",
      tenantCnpj: tenant?.cnpj ?? null,
      manifestNumber: trip.manifestNumber ?? null,
      vehiclePlate: trip.vehiclePlate ?? null,
      vehicleType: trip.vehicleType ?? null,
      driverName: trip.driverName ?? null,
      driver1Cpf: trip.driver1Cpf ?? null,
      driver1Cnh: trip.driver1Cnh ?? null,
      driver1CnhCategory: trip.driver1CnhCategory ?? null,
      driver1CnhExpiry: trip.driver1CnhExpiry ?? null,
      driver2Name: trip.driver2Name ?? null,
      driver2Cpf: trip.driver2Cpf ?? null,
      driver2Cnh: trip.driver2Cnh ?? null,
      driver2CnhCategory: trip.driver2CnhCategory ?? null,
      driver2CnhExpiry: trip.driver2CnhExpiry ?? null,
      tourGuide: trip.tourGuide ?? null,
      tourGuideCpf: trip.tourGuideCpf ?? null,
      tourGuideRegistration: trip.tourGuideRegistration ?? null,
      boardingPoints: (trip.boardingPoints ?? []) as Array<{ id: string; name: string; time?: string }>,
      passengers: manifestPassengers,
      freePassengers: Array.isArray(trip.freePassengers) ? (trip.freePassengers as FreePassenger[]) : [],
      destinationCity: trip.destinationCity,
      destinationState: trip.destinationState,
      numberingType: layoutRow?.numberingType ?? null,
    };

    const pdfBuffer = await generateManifestPdf(panel);

    const safeName = trip.name.replace(/[^a-zA-Z0-9-_]/g, "_");
    const filename = `manifesto-${safeName}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    req.log.error({ err }, "Error generating manifest PDF");
    next(err);
  }
});

const AddTripMediaBody = z.object({
  url: z.string().url(),
  type: z.enum(["image", "video"]).default("image"),
  caption: z.string().max(500).optional(),
});

router.get("/trips/:id/media", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) { next(new ForbiddenError("Acesso restrito", "FORBIDDEN_ROLE")); return; }

    const [trip] = await db.select({ id: tripsTable.id }).from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId))).limit(1);
    if (!trip) { next(new NotFoundError("Viagem não encontrada", "TRIP_NOT_FOUND")); return; }

    const media = await db.select()
      .from(tripMediaTable)
      .where(and(eq(tripMediaTable.tripId, req.params.id), eq(tripMediaTable.tenantId, me.tenantId)))
      .orderBy(asc(tripMediaTable.createdAt));

    res.json({
      data: media.map(m => ({
        id: m.id,
        url: m.url,
        type: m.type,
        caption: m.caption,
        uploadedByUserId: m.uploadedByUserId,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (err) { next(err); }
});

router.post("/trips/:id/media", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) { next(new ForbiddenError("Acesso restrito", "FORBIDDEN_ROLE")); return; }

    const [trip] = await db.select({ id: tripsTable.id }).from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId))).limit(1);
    if (!trip) { next(new NotFoundError("Viagem não encontrada", "TRIP_NOT_FOUND")); return; }

    const parsed = AddTripMediaBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }

    const id = generateId();
    await db.insert(tripMediaTable).values({
      id,
      tripId: req.params.id,
      tenantId: me.tenantId,
      url: parsed.data.url,
      type: parsed.data.type,
      caption: parsed.data.caption ?? null,
      uploadedByUserId: me.id,
    });

    res.status(201).json({ id, url: parsed.data.url, type: parsed.data.type, caption: parsed.data.caption ?? null, createdAt: new Date().toISOString() });
  } catch (err) { next(err); }
});

router.delete("/trips/:id/media/:mediaId", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) { next(new ForbiddenError("Acesso restrito", "FORBIDDEN_ROLE")); return; }

    const [media] = await db.select()
      .from(tripMediaTable)
      .where(and(eq(tripMediaTable.id, req.params.mediaId), eq(tripMediaTable.tenantId, me.tenantId)))
      .limit(1);
    if (!media || media.tripId !== req.params.id) { next(new NotFoundError("Mídia não encontrada", "NOT_FOUND")); return; }

    await db.delete(tripMediaTable).where(eq(tripMediaTable.id, req.params.mediaId));

    // Best-effort: remove the file from UploadThing storage.
    // deleteOrphanedFile catches its own errors internally, so a storage
    // failure never blocks the 204 response.
    await deleteOrphanedFile(media.url, null, req.log, me.tenantId);

    res.status(204).send();
  } catch (err) { next(err); }
});

// ─── Staff check-in routes (Clerk JWT) ───────────────────────────────────────

router.get("/trips/:id/checkins", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }
    const [trip] = await db.select({ id: tripsTable.id })
      .from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id!), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Viagem não encontrada", "TRIP_NOT_FOUND")); return; }
    const checkins = await db.select()
      .from(tripCheckinsTable)
      .where(and(eq(tripCheckinsTable.tripId, req.params.id!), eq(tripCheckinsTable.tenantId, me.tenantId)));
    res.json({ data: checkins });
  } catch (err) { next(err); }
});

router.post("/trips/:id/checkins", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }
    const { passengerId, reservationId, notes, status } = z.object({
      passengerId: z.string().min(1),
      reservationId: z.string().optional(),
      notes: z.string().optional(),
      status: z.enum(["present", "absent"]).default("present"),
    }).parse(req.body);

    const [trip] = await db.select({ id: tripsTable.id })
      .from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id!), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Viagem não encontrada", "TRIP_NOT_FOUND")); return; }

    const [passenger] = await db.select({ id: passengersTable.id })
      .from(passengersTable)
      .innerJoin(reservationsTable, eq(passengersTable.reservationId, reservationsTable.id))
      .where(and(
        eq(passengersTable.id, passengerId),
        eq(reservationsTable.tripId, req.params.id!),
        eq(reservationsTable.tenantId, me.tenantId),
      ))
      .limit(1);
    if (!passenger) { next(new NotFoundError("Passageiro não encontrado", "PASSENGER_NOT_FOUND")); return; }

    const checkedInAt = new Date();
    await db.insert(tripCheckinsTable)
      .values({
        id: generateId(),
        tripId: req.params.id!,
        tenantId: me.tenantId,
        passengerId,
        reservationId: reservationId ?? null,
        checkedInByUserRef: me.id,
        checkedInAt,
        notes: notes ?? null,
        status,
      })
      .onConflictDoUpdate({
        target: [tripCheckinsTable.tripId, tripCheckinsTable.passengerId],
        set: { checkedInByUserRef: me.id, checkedInAt, notes: notes ?? null, status },
      });

    await db.update(passengersTable)
      .set({ checkedInAt: status === "present" ? checkedInAt : null })
      .where(eq(passengersTable.id, passengerId));

    emitBoardingUpdate(req.params.id!);
    res.status(201).json({ success: true, passengerId, status, checkedInAt: checkedInAt.toISOString() });
  } catch (err) { next(err); }
});

router.delete("/trips/:id/checkins/:passengerId", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }
    const [trip] = await db.select({ id: tripsTable.id })
      .from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id!), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Viagem não encontrada", "TRIP_NOT_FOUND")); return; }

    const [passenger] = await db.select({ id: passengersTable.id })
      .from(passengersTable)
      .innerJoin(reservationsTable, eq(passengersTable.reservationId, reservationsTable.id))
      .where(and(
        eq(passengersTable.id, req.params.passengerId!),
        eq(reservationsTable.tripId, req.params.id!),
        eq(reservationsTable.tenantId, me.tenantId),
      ))
      .limit(1);
    if (!passenger) { next(new NotFoundError("Passageiro não encontrado", "PASSENGER_NOT_FOUND")); return; }

    await db.delete(tripCheckinsTable)
      .where(and(
        eq(tripCheckinsTable.tripId, req.params.id!),
        eq(tripCheckinsTable.passengerId, req.params.passengerId!),
        eq(tripCheckinsTable.tenantId, me.tenantId),
      ));
    await db.update(passengersTable)
      .set({ checkedInAt: null })
      .where(eq(passengersTable.id, req.params.passengerId!));
    emitBoardingUpdate(req.params.id!);
    res.status(204).send();
  } catch (err) { next(err); }
});

// ─── Boarding live status + SSE stream ────────────────────────────────────────

router.get("/trips/:id/boarding-live", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    const [trip] = await db.select({
      id: tripsTable.id,
      name: tripsTable.name,
      status: tripsTable.status,
      departureDate: tripsTable.departureDate,
      boardingPoints: tripsTable.boardingPoints,
      freePassengers: tripsTable.freePassengers,
    })
      .from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id!), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Viagem não encontrada", "TRIP_NOT_FOUND")); return; }

    const reservations = await db.select({ id: reservationsTable.id, status: reservationsTable.status, boardingLocationId: reservationsTable.boardingLocationId })
      .from(reservationsTable)
      .where(and(
        eq(reservationsTable.tripId, trip.id),
        eq(reservationsTable.tenantId, me.tenantId),
        sql`${reservationsTable.status} NOT IN (${RESERVATION_STATUS.CANCELLED}, ${RESERVATION_STATUS.REFUNDED})`,
      ));

    const activeResIds = reservations.map(r => r.id);
    const passengers = activeResIds.length > 0
      ? await db.select({
          id: passengersTable.id,
          name: passengersTable.name,
          seatNumber: passengersTable.seatNumber,
          boardingLocationId: passengersTable.boardingLocationId,
          reservationId: passengersTable.reservationId,
          checkedInAt: passengersTable.checkedInAt,
        }).from(passengersTable).where(inArray(passengersTable.reservationId, activeResIds))
      : [];

    const checkins = await db.select()
      .from(tripCheckinsTable)
      .where(and(eq(tripCheckinsTable.tripId, trip.id), eq(tripCheckinsTable.tenantId, me.tenantId)));

    const checkinMap = new Map(checkins.map(c => [c.passengerId, c]));

    const [boardingLocations] = await Promise.all([
      db.select({ id: boardingLocationsTable.id, name: boardingLocationsTable.name })
        .from(boardingLocationsTable)
        .where(eq(boardingLocationsTable.tenantId, me.tenantId)),
    ]);

    const boardingPoints = (Array.isArray(trip.boardingPoints) ? trip.boardingPoints : []) as Array<{ id: string; name: string; time?: string }>;
    const bpMap = new Map(boardingPoints.map(bp => [bp.id, bp]));
    const blMap = new Map(boardingLocations.map(bl => [bl.id, bl.name]));

    const reservationMap = new Map(reservations.map(r => [r.id, r]));

    const freePassengers = (Array.isArray(trip.freePassengers) ? trip.freePassengers : []) as FreePassenger[];

    let checkedIn = 0;
    let absent = 0;
    const absentPassengers: Array<{ id: string; name: string; seatNumber: string | null; boardingLocationId: string | null; boardingLocationName: string | null; isFree: boolean }> = [];

    for (const p of passengers) {
      const c = checkinMap.get(p.id);
      const reservation = reservationMap.get(p.reservationId);
      const effectiveBoardingLocationId = p.boardingLocationId ?? reservation?.boardingLocationId ?? null;
      const boardingLocationName = effectiveBoardingLocationId
        ? (bpMap.get(effectiveBoardingLocationId)?.name ?? blMap.get(effectiveBoardingLocationId) ?? null)
        : null;
      if (c?.status === "present") {
        checkedIn++;
      } else if (c?.status === "absent") {
        absent++;
        absentPassengers.push({
          id: p.id,
          name: p.name,
          seatNumber: p.seatNumber ?? null,
          boardingLocationId: effectiveBoardingLocationId,
          boardingLocationName,
          isFree: false,
        });
      } else {
        absentPassengers.push({
          id: p.id,
          name: p.name,
          seatNumber: p.seatNumber ?? null,
          boardingLocationId: effectiveBoardingLocationId,
          boardingLocationName,
          isFree: false,
        });
      }
    }

    let freeCheckedIn = 0;
    for (const fp of freePassengers) {
      if (fp.checkedInAt) {
        freeCheckedIn++;
      } else {
        absentPassengers.push({
          id: fp.id,
          name: fp.name,
          seatNumber: fp.seatNumber ?? null,
          boardingLocationId: null,
          boardingLocationName: null,
          isFree: true,
        });
      }
    }

    const totalCheckedIn = checkedIn + freeCheckedIn;
    const total = passengers.length + freePassengers.length;
    const pending = total - totalCheckedIn - absent;

    const [guideLocation] = await db.select()
      .from(tripGuideLocationsTable)
      .where(and(
        eq(tripGuideLocationsTable.tripId, trip.id),
        eq(tripGuideLocationsTable.tenantId, me.tenantId),
      ))
      .limit(1);

    res.json({
      tripId: trip.id,
      tripName: trip.name,
      status: trip.status,
      departureDate: trip.departureDate.toISOString(),
      checkedIn: totalCheckedIn,
      absent,
      pending,
      total,
      absentPassengers,
      guideLocation: guideLocation
        ? {
            lat: guideLocation.lat,
            lng: guideLocation.lng,
            guideName: guideLocation.guideName ?? null,
            updatedAt: guideLocation.recordedAt.toISOString(),
          }
        : null,
      boardingPoints,
    });
  } catch (err) { next(err); }
});

router.get("/trips/:id/boarding-live/stream", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    const tripId = req.params.id!;
    const [trip] = await db.select({ id: tripsTable.id })
      .from(tripsTable)
      .where(and(eq(tripsTable.id, tripId), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Viagem não encontrada", "TRIP_NOT_FOUND")); return; }

    const clientIp = getClientIp(req);
    if (!tryAddBoardingClient(tripId, res, clientIp)) {
      next(new AppError("Too many concurrent boarding stream connections", 429, "TOO_MANY_REQUESTS"));
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const ping = setInterval(() => {
      try { res.write(": ping\n\n"); } catch { clearInterval(ping); }
    }, 30000);

    req.on("close", () => {
      clearInterval(ping);
      removeBoardingClient(tripId, res);
    });
  } catch (err) { next(err); }
});

// ─── WhatsApp bulk broadcast ───────────────────────────────────────────────────

const WhatsAppBroadcastBody = z.object({
  messageTemplate: z.string().min(1).max(2000),
  filter: z.enum(["all", "confirmed", "pending"]),
});

router.post("/trips/:id/whatsapp-broadcast", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) { next(new ForbiddenError("Acesso restrito", "FORBIDDEN_ROLE")); return; }

    const parsed = WhatsAppBroadcastBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }

    const [trip] = await db.select().from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id!), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Trip not found", "TRIP_NOT_FOUND")); return; }

    const [tenantRow] = await db.select({ name: tenantsTable.name })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, me.tenantId))
      .limit(1);
    const tenantName = tenantRow?.name ?? "";
    const departureDate = format(trip.departureDate, "dd/MM/yyyy", { locale: ptBR });

    const conditions: ReturnType<typeof eq>[] = [
      eq(reservationsTable.tripId, trip.id),
      eq(reservationsTable.tenantId, me.tenantId),
    ];
    if (parsed.data.filter === "confirmed") {
      conditions.push(eq(reservationsTable.status, "confirmed" as const));
    } else if (parsed.data.filter === "pending") {
      conditions.push(eq(reservationsTable.status, "pending" as const));
    } else {
      // "all" — exclude cancelled and refunded, matching active-passenger convention
      conditions.push(sql`${reservationsTable.status} NOT IN ('cancelled', 'refunded')`);
    }

    const reservations = await db
      .select({
        id: reservationsTable.id,
        clientId: reservationsTable.clientId,
        reservationNumber: reservationsTable.reservationNumber,
        voucherCode: reservationsTable.voucherCode,
      })
      .from(reservationsTable)
      .where(and(...conditions));

    const reservationIds = reservations.map(r => r.id);
    const clientIds = reservations.map(r => r.clientId).filter((id): id is string => id != null);

    // Fetch passengers and booking clients in parallel (skip DB calls when no reservations)
    const [passengers, clients] = await Promise.all([
      reservationIds.length > 0
        ? db.select({
            id: passengersTable.id,
            reservationId: passengersTable.reservationId,
            name: passengersTable.name,
            phone: passengersTable.phone,
            boardingLocationId: passengersTable.boardingLocationId,
          })
          .from(passengersTable)
          .where(inArray(passengersTable.reservationId, reservationIds))
        : Promise.resolve([]),
      clientIds.length > 0
        ? db.select({
            id: clientsTable.id,
            name: clientsTable.name,
            whatsapp: clientsTable.whatsapp,
            phone: clientsTable.phone,
          })
          .from(clientsTable)
          .where(inArray(clientsTable.id, clientIds))
        : Promise.resolve([]),
    ]);

    const clientMap = new Map(clients.map(c => [c.id, c]));
    const reservationMap = new Map(reservations.map(r => [r.id, r]));
    const boardingPoints = (trip.boardingPoints ?? []) as Array<{ id: string; name: string }>;
    const bpMap = new Map(boardingPoints.map(bp => [bp.id, bp.name]));

    const { interpolateWhatsAppMessage } = await import("../lib/whatsapp.js");
    const { enqueueWhatsAppMessage } = await import("../queues/whatsapp-helpers.js");

    let queued = 0;
    let skipped = 0;
    // Track already-sent phones to avoid duplicate messages to the same number
    const sentPhones = new Set<string>();

    for (const passenger of passengers) {
      const reservation = reservationMap.get(passenger.reservationId);
      if (!reservation) { skipped++; continue; }

      // Prefer passenger's own phone; fall back to booking client's contact
      const bookingClient = reservation.clientId ? clientMap.get(reservation.clientId) : null;
      const phone = passenger.phone || bookingClient?.whatsapp || bookingClient?.phone;
      if (!phone) { skipped++; continue; }

      // Deduplicate — if multiple passengers share a contact number, send once
      const normalizedPhone = phone.replace(/\D/g, "");
      if (sentPhones.has(normalizedPhone)) { skipped++; continue; }
      sentPhones.add(normalizedPhone);

      const localSaida = passenger.boardingLocationId
        ? (bpMap.get(passenger.boardingLocationId) ?? "")
        : "";
      const ref = reservation.reservationNumber ?? reservation.voucherCode ?? "";

      const message = interpolateWhatsAppMessage(parsed.data.messageTemplate, {
        nome: passenger.name,
        viagem: trip.name,
        data: departureDate,
        referencia: ref,
        agencia: tenantName,
        local_saida: localSaida,
      });

      try {
        await enqueueWhatsAppMessage(phone, message, me.tenantId);
        queued++;
      } catch {
        skipped++;
      }
    }

    // Also include free passengers (organizers/guides) stored in the trip JSON
    const tripFreePassengers = Array.isArray(trip.freePassengers)
      ? (trip.freePassengers as Array<{ id: string; name: string; whatsapp: string; role: string }>)
      : [];

    for (const fp of tripFreePassengers) {
      const phone = fp.whatsapp?.trim();
      if (!phone) { skipped++; continue; }
      const normalizedPhone = phone.replace(/\D/g, "");
      if (sentPhones.has(normalizedPhone)) { skipped++; continue; }
      sentPhones.add(normalizedPhone);

      const message = interpolateWhatsAppMessage(parsed.data.messageTemplate, {
        nome: fp.name,
        viagem: trip.name,
        data: departureDate,
        referencia: "",
        agencia: tenantName,
        local_saida: "",
      });

      try {
        await enqueueWhatsAppMessage(phone, message, me.tenantId);
        queued++;
      } catch {
        skipped++;
      }
    }

    res.json({ queued, skipped });
  } catch (err) {
    next(err);
  }
});

// ─── Guide location read (staff Clerk JWT) ────────────────────────────────────

router.get("/trips/:id/location", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const [location] = await db.select()
      .from(tripGuideLocationsTable)
      .where(and(
        eq(tripGuideLocationsTable.tripId, req.params.id!),
        eq(tripGuideLocationsTable.tenantId, me.tenantId),
      ))
      .limit(1);
    res.json({ location: location ?? null });
  } catch (err) { next(err); }
});

export default router;
