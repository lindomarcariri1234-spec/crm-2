import { Router, type NextFunction } from "express";
import { db, productCategoriesTable, productImagesTable, cartItemsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { generateId } from "../lib/id";
import { requireAuth, ADMIN_ROLES } from '../lib/tenant';
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";

const router = Router();

const CreateCategoryBody = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional(),
  parentId: z.string().optional(),
  imageUrl: z.string().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const CreateProductImageBody = z.object({
  productId: z.string(),
  url: z.string().url(),
  altText: z.string().optional(),
  sortOrder: z.number().int().optional(),
});

const CreateCartItemBody = z.object({
  clientId: z.string(),
  productId: z.string(),
  quantity: z.number().int().min(1).optional(),
});

router.get("/product-categories", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const categories = await db.select().from(productCategoriesTable)
      .where(eq(productCategoriesTable.tenantId, me.tenantId))
      .orderBy(productCategoriesTable.sortOrder);
    res.json(categories);
  } catch (err) {
    next(err);
  }
});

router.post("/product-categories", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = CreateCategoryBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    const id = generateId();
    await db.insert(productCategoriesTable).values({ id, tenantId: me.tenantId, ...parsed.data });
    const [cat] = await db.select().from(productCategoriesTable).where(eq(productCategoriesTable.id, id)).limit(1);
    res.status(201).json(cat);
  } catch (err) {
    next(err);
  }
});

router.patch("/product-categories/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = CreateCategoryBody.partial().safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    await db.update(productCategoriesTable).set(parsed.data)
      .where(and(eq(productCategoriesTable.id, req.params.id), eq(productCategoriesTable.tenantId, me.tenantId)));
    const [cat] = await db.select().from(productCategoriesTable)
      .where(and(eq(productCategoriesTable.id, req.params.id), eq(productCategoriesTable.tenantId, me.tenantId))).limit(1);
    if (!cat) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(cat);
  } catch (err) {
    next(err);
  }
});

router.delete("/product-categories/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    await db.delete(productCategoriesTable)
      .where(and(eq(productCategoriesTable.id, req.params.id), eq(productCategoriesTable.tenantId, me.tenantId)));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get("/product-images", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const images = await db.select().from(productImagesTable)
      .where(eq(productImagesTable.tenantId, me.tenantId))
      .orderBy(productImagesTable.sortOrder);
    res.json(images);
  } catch (err) {
    next(err);
  }
});

router.post("/product-images", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = CreateProductImageBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    const id = generateId();
    await db.insert(productImagesTable).values({ id, tenantId: me.tenantId, ...parsed.data });
    const [img] = await db.select().from(productImagesTable).where(eq(productImagesTable.id, id)).limit(1);
    res.status(201).json(img);
  } catch (err) {
    next(err);
  }
});

router.delete("/product-images/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    await db.delete(productImagesTable)
      .where(and(eq(productImagesTable.id, req.params.id), eq(productImagesTable.tenantId, me.tenantId)));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get("/cart-items", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const items = await db.select().from(cartItemsTable)
      .where(eq(cartItemsTable.tenantId, me.tenantId))
      .orderBy(desc(cartItemsTable.addedAt));
    res.json(items);
  } catch (err) {
    next(err);
  }
});

router.post("/cart-items", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const parsed = CreateCartItemBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    const id = generateId();
    await db.insert(cartItemsTable).values({ id, tenantId: me.tenantId, ...parsed.data });
    const [item] = await db.select().from(cartItemsTable).where(eq(cartItemsTable.id, id)).limit(1);
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

router.delete("/cart-items/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    await db.delete(cartItemsTable)
      .where(and(eq(cartItemsTable.id, req.params.id), eq(cartItemsTable.tenantId, me.tenantId)));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
