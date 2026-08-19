/**
 * upload-orphan-cleanup.test.ts
 *
 * Regression guard for the orphan-file cleanup path in POST /upload/image
 * and POST /upload/video.
 *
 * When a tripId is supplied the endpoint:
 *   1. Calls utapi.uploadFiles → file lands in UploadThing
 *   2. Calls db.insert(tripMediaTable) → creates the DB record
 *
 * If step 2 fails (or the caller is unauthorized / trip not found) the
 * UploadThing file has already been created.  The route must call
 * utapi.deleteFiles(key) before responding so the file does not become a
 * permanent orphan.
 *
 * These tests verify each branch where cleanup is required:
 *   - db.insert throws after a successful upload
 *   - caller role is not in MANAGEMENT_ROLES (403)
 *   - trip not found in DB (404)
 * And the happy-path where cleanup must NOT be called.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── Hoisted mock state — accessible inside vi.mock() factories ──────────────

const {
  mockUploadFiles,
  mockDeleteFiles,
  mockSelect,
  mockFrom,
  mockWhere,
  mockLimit,
  mockInsert,
  mockInsertValues,
} = vi.hoisted(() => {
  const mockDeleteFiles = vi.fn();
  const mockUploadFiles = vi.fn();

  // db.select().from().where().limit() chain
  const mockLimit = vi.fn();
  const mockWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockFrom = vi.fn(() => ({ where: mockWhere, limit: mockLimit }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));

  // db.insert().values() chain
  const mockInsertValues = vi.fn();
  const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

  return {
    mockUploadFiles,
    mockDeleteFiles,
    mockSelect,
    mockFrom,
    mockWhere,
    mockLimit,
    mockInsert,
    mockInsertValues,
  };
});

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock("../lib/uploadthing.js", () => ({
  utapi: {
    uploadFiles: mockUploadFiles,
    deleteFiles: mockDeleteFiles,
  },
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
  },
  tripsTable: { id: "trips.id", tenantId: "trips.tenantId" },
  tripMediaTable: {},
}));

vi.mock("drizzle-orm", async () => {
  const { makeDrizzleOrmMock } = await import("./helpers/drizzle-mock.js");
  return makeDrizzleOrmMock();
});

vi.mock("../lib/tenant.js", () => ({
  requireAuth: vi.fn(),
  MANAGEMENT_ROLES: ["admin", "gerente"],
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "generated-media-id"),
}));

// ── App & imports ───────────────────────────────────────────────────────────

import { requireAuth } from "../lib/tenant.js";
import uploadRouter from "../routes/upload.js";

const TRIP_ID = "trip-abc-123";
const FILE_KEY = "test-file-key-abc";
const FILE_URL = `https://utfs.io/f/${FILE_KEY}`;

function buildApp() {
  const app = express();
  app.use(express.json());
  // req.log stub so req.log?.info() / req.log?.error() don't throw
  app.use((req, _res, next) => {
    (req as unknown as Record<string, unknown>).log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    next();
  });
  app.use("/upload", uploadRouter);
  // Minimal error handler: surfacing the thrown error as 500
  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(500).json({ error: err.message });
    },
  );
  return app;
}

const app = buildApp();

// ── Shared beforeEach ───────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default successful upload result
  mockUploadFiles.mockResolvedValue({
    data: { ufsUrl: FILE_URL, key: FILE_KEY, name: "photo.jpg", size: 12345 },
    error: null,
  });
  mockDeleteFiles.mockResolvedValue(undefined);

  // Default auth: management-role user
  vi.mocked(requireAuth).mockResolvedValue({
    id: "user-1",
    tenantId: "tenant-1",
    role: "admin",
  } as never);

  // Default: trip found
  mockLimit.mockResolvedValue([{ id: TRIP_ID }]);
  // Default: insert succeeds
  mockInsertValues.mockResolvedValue([]);
});

// ── Image upload tests ──────────────────────────────────────────────────────

describe("POST /upload/image with tripId — orphan cleanup", () => {
  it("calls utapi.deleteFiles and returns 500 when db.insert throws after upload", async () => {
    mockInsertValues.mockRejectedValueOnce(new Error("DB connection lost"));

    const res = await request(app)
      .post("/upload/image")
      .field("tripId", TRIP_ID)
      .field("caption", "Nossa viagem incrível")
      .attach("file", Buffer.from("fake-image-bytes"), {
        filename: "photo.jpg",
        contentType: "image/jpeg",
      });

    // Upload was attempted
    expect(mockUploadFiles).toHaveBeenCalledOnce();
    // Cleanup called with the exact key returned by the upload
    expect(mockDeleteFiles).toHaveBeenCalledOnce();
    expect(mockDeleteFiles).toHaveBeenCalledWith(FILE_KEY);
    // Client receives a 500 (not a silent swallow)
    expect(res.status).toBe(500);
  });

  it("does NOT call utapi.deleteFiles when db.insert succeeds (happy path)", async () => {
    const res = await request(app)
      .post("/upload/image")
      .field("tripId", TRIP_ID)
      .field("caption", "Foto da viagem")
      .attach("file", Buffer.from("fake-image-bytes"), {
        filename: "photo.jpg",
        contentType: "image/jpeg",
      });

    expect(mockUploadFiles).toHaveBeenCalledOnce();
    expect(mockDeleteFiles).not.toHaveBeenCalled();
    expect(res.status).toBe(201);
    expect(res.body.id).toBe("generated-media-id");
    expect(res.body.type).toBe("image");
  });

  it("calls utapi.deleteFiles and returns 403 when caller lacks management role", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce({
      id: "user-2",
      tenantId: "tenant-1",
      role: "client", // not in MANAGEMENT_ROLES
    } as never);

    const res = await request(app)
      .post("/upload/image")
      .field("tripId", TRIP_ID)
      .attach("file", Buffer.from("fake-image-bytes"), {
        filename: "photo.jpg",
        contentType: "image/jpeg",
      });

    // Upload happened before auth check — file must be cleaned up
    expect(mockDeleteFiles).toHaveBeenCalledOnce();
    expect(mockDeleteFiles).toHaveBeenCalledWith(FILE_KEY);
    expect(res.status).toBe(403);
  });

  it("calls utapi.deleteFiles and returns 404 when trip is not found", async () => {
    mockLimit.mockResolvedValueOnce([]); // empty result = trip not found

    const res = await request(app)
      .post("/upload/image")
      .field("tripId", TRIP_ID)
      .attach("file", Buffer.from("fake-image-bytes"), {
        filename: "photo.jpg",
        contentType: "image/jpeg",
      });

    expect(mockDeleteFiles).toHaveBeenCalledOnce();
    expect(mockDeleteFiles).toHaveBeenCalledWith(FILE_KEY);
    expect(res.status).toBe(404);
  });

  it("does NOT call utapi.deleteFiles when no tripId is provided (plain image upload)", async () => {
    const res = await request(app)
      .post("/upload/image")
      .attach("file", Buffer.from("fake-image-bytes"), {
        filename: "photo.jpg",
        contentType: "image/jpeg",
      });

    expect(mockUploadFiles).toHaveBeenCalledOnce();
    expect(mockDeleteFiles).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(res.body.url).toBe(FILE_URL);
  });
});

// ── Video upload tests ──────────────────────────────────────────────────────

describe("POST /upload/video with tripId — orphan cleanup", () => {
  beforeEach(() => {
    // Video upload returns the same key — the cleanup logic is identical
    mockUploadFiles.mockResolvedValue({
      data: {
        ufsUrl: FILE_URL,
        key: FILE_KEY,
        name: "video.mp4",
        size: 99_999,
      },
      error: null,
    });
  });

  it("calls utapi.deleteFiles and returns 500 when db.insert throws after video upload", async () => {
    mockInsertValues.mockRejectedValueOnce(new Error("DB connection lost"));

    const res = await request(app)
      .post("/upload/video")
      .field("tripId", TRIP_ID)
      .attach("file", Buffer.from("fake-video-bytes"), {
        filename: "video.mp4",
        contentType: "video/mp4",
      });

    expect(mockUploadFiles).toHaveBeenCalledOnce();
    expect(mockDeleteFiles).toHaveBeenCalledOnce();
    expect(mockDeleteFiles).toHaveBeenCalledWith(FILE_KEY);
    expect(res.status).toBe(500);
  });

  it("does NOT call utapi.deleteFiles when video db.insert succeeds (happy path)", async () => {
    const res = await request(app)
      .post("/upload/video")
      .field("tripId", TRIP_ID)
      .attach("file", Buffer.from("fake-video-bytes"), {
        filename: "video.mp4",
        contentType: "video/mp4",
      });

    expect(mockDeleteFiles).not.toHaveBeenCalled();
    expect(res.status).toBe(201);
    expect(res.body.type).toBe("video");
    expect(res.body.id).toBe("generated-media-id");
  });

  it("calls utapi.deleteFiles and returns 403 when caller lacks management role (video)", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce({
      id: "user-2",
      tenantId: "tenant-1",
      role: "client",
    } as never);

    const res = await request(app)
      .post("/upload/video")
      .field("tripId", TRIP_ID)
      .attach("file", Buffer.from("fake-video-bytes"), {
        filename: "video.mp4",
        contentType: "video/mp4",
      });

    expect(mockDeleteFiles).toHaveBeenCalledWith(FILE_KEY);
    expect(res.status).toBe(403);
  });
});
