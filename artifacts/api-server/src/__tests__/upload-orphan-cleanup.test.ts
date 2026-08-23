/**
 * upload-orphan-cleanup.test.ts
 *
 * Regression guard for the upload routes, including orphan-file cleanup in
 * POST /upload/image and POST /upload/video.
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

describe("POST /upload/images — gallery uploads", () => {
  it("accepts the frontend files field and returns one result for each image", async () => {
    mockUploadFiles.mockResolvedValueOnce([
      {
        data: { ufsUrl: "https://utfs.io/f/image-one", key: "image-one", name: "one.jpg", size: 101 },
        error: null,
      },
      {
        data: { ufsUrl: "https://utfs.io/f/image-two", key: "image-two", name: "two.webp", size: 202 },
        error: null,
      },
    ]);

    const res = await request(app)
      .post("/upload/images")
      .attach("files", Buffer.from("first-image"), {
        filename: "one.jpg",
        contentType: "image/jpeg",
      })
      .attach("files", Buffer.from("second-image"), {
        filename: "two.webp",
        contentType: "image/webp",
      });

    expect(vi.mocked(requireAuth)).toHaveBeenCalledOnce();
    expect(mockUploadFiles).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        url: "https://utfs.io/f/image-one",
        key: "image-one",
        name: "one.jpg",
        size: 101,
        mimeType: "image/jpeg",
      },
      {
        url: "https://utfs.io/f/image-two",
        key: "image-two",
        name: "two.webp",
        size: 202,
        mimeType: "image/webp",
      },
    ]);
  });

  it("rejects a request without gallery files", async () => {
    const res = await request(app).post("/upload/images");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Nenhum arquivo enviado");
    expect(mockUploadFiles).not.toHaveBeenCalled();
  });

  it("requires an authenticated user before uploading gallery files", async () => {
    vi.mocked(requireAuth).mockImplementationOnce(async (_req, res) => {
      res.status(401).json({ error: "Não autenticado" });
      return null;
    });

    const res = await request(app)
      .post("/upload/images")
      .attach("files", Buffer.from("image-data"), {
        filename: "image.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(401);
    expect(mockUploadFiles).not.toHaveBeenCalled();
  });

  it("rejects non-image gallery files with a useful 400 response", async () => {
    const res = await request(app)
      .post("/upload/images")
      .attach("files", Buffer.from("not an image"), {
        filename: "notes.txt",
        contentType: "text/plain",
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: "Apenas imagens são permitidas",
      code: "INVALID_FILE_TYPE",
    });
    expect(mockUploadFiles).not.toHaveBeenCalled();
  });

  it("rejects more than ten gallery files before sending anything to UploadThing", async () => {
    let requestBuilder = request(app).post("/upload/images");
    for (let index = 0; index < 11; index++) {
      requestBuilder = requestBuilder.attach("files", Buffer.from(`image-${index}`), {
        filename: `image-${index}.jpg`,
        contentType: "image/jpeg",
      });
    }

    const res = await requestBuilder;

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TOO_MANY_FILES");
    expect(mockUploadFiles).not.toHaveBeenCalled();
  });

  it("enforces the gallery size limit supplied by the frontend", async () => {
    const res = await request(app)
      .post("/upload/images")
      .field("maxSizeMB", "0.000001")
      .attach("files", Buffer.from("image-data"), {
        filename: "oversized.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(413);
    expect(res.body.error).toContain("Arquivo");
    expect(mockUploadFiles).not.toHaveBeenCalled();
  });

  it("returns the UploadThing error instead of a successful gallery payload", async () => {
    mockUploadFiles.mockResolvedValueOnce([
      { data: null, error: { message: "UploadThing indisponível" } },
    ]);

    const res = await request(app)
      .post("/upload/images")
      .attach("files", Buffer.from("image-data"), {
        filename: "image.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("UploadThing indisponível");
  });
});

describe("POST /upload/document", () => {
  it("accepts the singular file field used by the client document uploader", async () => {
    mockUploadFiles.mockResolvedValueOnce({
      data: {
        ufsUrl: "https://utfs.io/f/document-pdf",
        key: "document-pdf",
        name: "contract.pdf",
        size: 777,
      },
      error: null,
    });

    const res = await request(app)
      .post("/upload/document")
      .attach("file", Buffer.from("pdf-data"), {
        filename: "contract.pdf",
        contentType: "application/pdf",
      });

    expect(vi.mocked(requireAuth)).toHaveBeenCalledOnce();
    expect(mockUploadFiles).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      url: "https://utfs.io/f/document-pdf",
      key: "document-pdf",
      name: "contract.pdf",
      size: 777,
      mimeType: "application/pdf",
    });
  });

  it("rejects unsupported document types with a useful 400 response", async () => {
    const res = await request(app)
      .post("/upload/document")
      .attach("file", Buffer.from("plain text"), {
        filename: "notes.txt",
        contentType: "text/plain",
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: "Tipo de arquivo não permitido",
      code: "INVALID_FILE_TYPE",
    });
    expect(mockUploadFiles).not.toHaveBeenCalled();
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
