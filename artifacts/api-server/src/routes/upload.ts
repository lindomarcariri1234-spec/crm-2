import { Router, type NextFunction } from "express";
import multer, { memoryStorage } from "multer";
import { utapi } from "../lib/uploadthing";
import { requireAuth, MANAGEMENT_ROLES } from "../lib/tenant";
import { db } from "@workspace/db";
import { tripsTable, tripMediaTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { generateId } from "../lib/id";

const router = Router();

const imageUpload = multer({
  storage: memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Apenas imagens são permitidas"));
    }
    cb(null, true);
  },
});

const documentUpload = multer({
  storage: memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "image/",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];
    const ok = allowed.some((t) =>
      t.endsWith("/") ? file.mimetype.startsWith(t) : file.mimetype === t
    );
    if (!ok) return cb(new Error("Tipo de arquivo não permitido"));
    cb(null, true);
  },
});

router.post("/image", imageUpload.single("file"), async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    if (!req.file) {
      res.status(400).json({ error: "Nenhum arquivo enviado" });
      return;
    }

    const maxSizeMB = req.body?.maxSizeMB ? parseFloat(req.body.maxSizeMB as string) : null;
    if (maxSizeMB && !isNaN(maxSizeMB) && req.file.size > maxSizeMB * 1024 * 1024) {
      res.status(413).json({
        error: `Arquivo muito grande. Máximo permitido: ${maxSizeMB} MB (recebido: ${(req.file.size / 1024 / 1024).toFixed(1)} MB)`,
      });
      return;
    }

    req.log?.info(
      { size: req.file.size, mime: req.file.mimetype, name: req.file.originalname },
      "[upload] received image, uploading to UploadThing"
    );

    // Use Buffer.from() to ensure the ArrayBuffer is fully isolated (byteOffset=0)
    // before passing to File — avoids potential shared-pool issues with multer buffers.
    const buf = Buffer.from(req.file.buffer);
    const file = new File([buf], req.file.originalname, { type: req.file.mimetype });

    const result = await utapi.uploadFiles(file);

    if (result.error) {
      req.log?.error({ err: result.error }, "[upload] utapi.uploadFiles failed (video)");
      res.status(500).json({ error: result.error.message });
      return;
    }

    // When tripId is provided, insert the record into trip_media atomically.
    const tripId = req.body?.tripId ? String(req.body.tripId) : undefined;
    if (tripId) {
      if (!MANAGEMENT_ROLES.includes(me.role)) {
        try { await utapi.deleteFiles(result.data.key); } catch { /* best-effort cleanup */ }
        res.status(403).json({ error: "Acesso restrito" });
        return;
      }
      const [trip] = await db
        .select({ id: tripsTable.id })
        .from(tripsTable)
        .where(and(eq(tripsTable.id, tripId), eq(tripsTable.tenantId, me.tenantId)))
        .limit(1);
      if (!trip) {
        try { await utapi.deleteFiles(result.data.key); } catch { /* best-effort cleanup */ }
        res.status(404).json({ error: "Viagem não encontrada" });
        return;
      }
      const rawCaption = req.body?.caption ? String(req.body.caption).trim() : null;
      const caption = rawCaption && rawCaption.length > 0 ? rawCaption.slice(0, 500) : null;
      const id = generateId();
      const createdAt = new Date();
      try {
        await db.insert(tripMediaTable).values({
          id,
          tripId,
          tenantId: me.tenantId,
          url: result.data.ufsUrl,
          type: "video",
          caption,
          uploadedByUserId: me.id,
        });
      } catch (insertErr) {
        try { await utapi.deleteFiles(result.data.key); } catch { /* best-effort */ }
        throw insertErr;
      }
      req.log?.info({ id, tripId, tenantId: me.tenantId }, "[upload] trip video media record created");
      res.status(201).json({
        id,
        url: result.data.ufsUrl,
        key: result.data.key,
        name: result.data.name,
        type: "video",
        caption,
        createdAt: createdAt.toISOString(),
        size: result.data.size,
        mimeType: req.file.mimetype,
      });
      return;
    }

    res.json({
      url: result.data.ufsUrl,
      key: result.data.key,
      name: result.data.name,
      size: result.data.size,
      mimeType: req.file.mimetype,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/document", documentUpload.single("file"), async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      res.status(400).json({ error: "Nenhum arquivo enviado" });
      return;
    }

    const maxSizeMB = req.body?.maxSizeMB ? parseFloat(req.body.maxSizeMB as string) : null;
    if (maxSizeMB && !isNaN(maxSizeMB)) {
      const oversized = files.find((f) => f.size > maxSizeMB * 1024 * 1024);
      if (oversized) {
        res.status(413).json({
          error: `Arquivo "${oversized.originalname}" muito grande. Máximo: ${maxSizeMB} MB`,
        });
        return;
      }
    }

    const uploadFiles = files.map(
      (f) => new File([Buffer.from(f.buffer)], f.originalname, { type: f.mimetype })
    );

    const results = await utapi.uploadFiles(uploadFiles);

    const errors = results.filter((r) => r.error);
    if (errors.length > 0) {
      res.status(500).json({ error: errors[0].error?.message ?? "Upload falhou" });
      return;
    }

    res.json(results.map((r) => ({ url: r.data!.ufsUrl, key: r.data!.key, name: r.data!.name })));
  } catch (err) {
    next(err);
  }
});

const VIDEO_MIMETYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/ogg",
  "video/x-msvideo",
  "video/avi",
];

const videoUpload = multer({
  storage: memoryStorage(),
  limits: { fileSize: 128 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!VIDEO_MIMETYPES.includes(file.mimetype)) {
      return cb(new Error("Tipo de vídeo não permitido. Use MP4, WebM, MOV, OGG ou AVI."));
    }
    cb(null, true);
  },
});

router.post("/video", videoUpload.single("file"), async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    if (!req.file) {
      res.status(400).json({ error: "Nenhum arquivo enviado" });
      return;
    }

    const buf = Buffer.from(req.file.buffer);
    const file = new File([buf], req.file.originalname, { type: req.file.mimetype });

    const result = await utapi.uploadFiles(file);

    if (result.error) {
      req.log?.error({ err: result.error }, "[upload] utapi.uploadFiles failed (video)");
      res.status(500).json({ error: result.error.message });
      return;
    }

    // When tripId is provided, insert the record into trip_media atomically.
    const tripId = req.body?.tripId ? String(req.body.tripId) : undefined;
    if (tripId) {
      if (!MANAGEMENT_ROLES.includes(me.role)) {
        try { await utapi.deleteFiles(result.data.key); } catch { /* best-effort cleanup */ }
        res.status(403).json({ error: "Acesso restrito" });
        return;
      }
      const [trip] = await db
        .select({ id: tripsTable.id })
        .from(tripsTable)
        .where(and(eq(tripsTable.id, tripId), eq(tripsTable.tenantId, me.tenantId)))
        .limit(1);
      if (!trip) {
        try { await utapi.deleteFiles(result.data.key); } catch { /* best-effort cleanup */ }
        res.status(404).json({ error: "Viagem não encontrada" });
        return;
      }
      const rawCaption = req.body?.caption ? String(req.body.caption).trim() : null;
      const caption = rawCaption && rawCaption.length > 0 ? rawCaption.slice(0, 500) : null;
      const id = generateId();
      const createdAt = new Date();
      try {
        await db.insert(tripMediaTable).values({
          id,
          tripId,
          tenantId: me.tenantId,
          url: result.data.ufsUrl,
          type: "video",
          caption,
          uploadedByUserId: me.id,
        });
      } catch (insertErr) {
        try { await utapi.deleteFiles(result.data.key); } catch { /* best-effort */ }
        throw insertErr;
      }
      req.log?.info({ id, tripId, tenantId: me.tenantId }, "[upload] trip video media record created");
      res.status(201).json({
        id,
        url: result.data.ufsUrl,
        key: result.data.key,
        name: result.data.name,
        type: "video",
        caption,
        createdAt: createdAt.toISOString(),
        size: result.data.size,
        mimeType: req.file.mimetype,
      });
      return;
    }

    res.json({
      url: result.data.ufsUrl,
      key: result.data.key,
      name: result.data.name,
      size: result.data.size,
      mimeType: req.file.mimetype,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/document", documentUpload.single("file"), async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    if (!req.file) {
      res.status(400).json({ error: "Nenhum arquivo enviado" });
      return;
    }

    const buf = Buffer.from(req.file.buffer);
    const file = new File([buf], req.file.originalname, { type: req.file.mimetype });

    const result = await utapi.uploadFiles(file);

    if (result.error) {
      req.log?.error({ err: result.error }, "[upload] utapi.uploadFiles failed (document)");
      res.status(500).json({ error: result.error.message });
      return;
    }

    res.json({
      url: result.data.ufsUrl,
      key: result.data.key,
      name: result.data.name,
      size: result.data.size,
      mimeType: req.file.mimetype,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
