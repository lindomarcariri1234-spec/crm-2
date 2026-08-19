import { Router, type NextFunction } from "express";
import { db, documentsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { generateId } from "../lib/id";
import { requireAuth } from "../lib/tenant";
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { ADMIN_ROLES, ALL_STAFF_ROLES } from '../lib/tenant';

const router = Router();

const CreateDocumentBody = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  url: z.string().url(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
});

router.get("/documents", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ALL_STAFF_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const documents = await db.select().from(documentsTable)
      .where(eq(documentsTable.tenantId, me.tenantId))
      .orderBy(desc(documentsTable.createdAt));
    res.json(documents);
  } catch (err) {
    next(err);
  }
});

router.post("/documents", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ALL_STAFF_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = CreateDocumentBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const id = generateId();
    await db.insert(documentsTable).values({ id, tenantId: me.tenantId, uploadedById: me.id, ...parsed.data });
    const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id)).limit(1);
    res.status(201).json(doc);
  } catch (err) {
    next(err);
  }
});

router.delete("/documents/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const [doc] = await db.select().from(documentsTable)
      .where(and(eq(documentsTable.id, req.params.id), eq(documentsTable.tenantId, me.tenantId))).limit(1);
    if (!doc) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    if (doc.uploadedById !== me.id && !ADMIN_ROLES.includes(me.role)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }
    await db.delete(documentsTable)
      .where(and(eq(documentsTable.id, req.params.id), eq(documentsTable.tenantId, me.tenantId)));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
