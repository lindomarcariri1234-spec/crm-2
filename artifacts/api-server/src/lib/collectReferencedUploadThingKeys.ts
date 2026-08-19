import { db, tenantsTable, usersTable, storesTable, storeProductsTable, storeCategoriesTable, storeOrderItemsTable, storeReviewsTable, tripsTable, productCategoriesTable, productImagesTable, vehiclesTable, accommodationsTable, destinationsTable, clientsTable } from "@workspace/db";
import { extractVerifiedUploadThingKey } from "./uploadthing";

export async function collectReferencedUploadThingKeys(): Promise<Set<string>> {
  const [
    tenants, stores, storeCategories, storeProducts, storeOrderItems, storeReviews,
    trips, productCategories, productImages,
    vehicles, accommodations, destinations,
    clients, users,
  ] = await Promise.all([
    db.select({ logoUrl: tenantsTable.logoUrl }).from(tenantsTable),
    db.select({ logo: storesTable.logo, logoDark: storesTable.logoDark, favicon: storesTable.favicon, bannerHome: storesTable.bannerHome, bannerMobile: storesTable.bannerMobile }).from(storesTable),
    db.select({ image: storeCategoriesTable.image }).from(storeCategoriesTable),
    db.select({ images: storeProductsTable.images, thumbnail: storeProductsTable.thumbnail, gallery: storeProductsTable.gallery }).from(storeProductsTable),
    db.select({ productImage: storeOrderItemsTable.productImage }).from(storeOrderItemsTable),
    db.select({ images: storeReviewsTable.images }).from(storeReviewsTable),
    db.select({ coverImage: tripsTable.coverImage, gallery: tripsTable.gallery }).from(tripsTable),
    db.select({ imageUrl: productCategoriesTable.imageUrl }).from(productCategoriesTable),
    db.select({ url: productImagesTable.url }).from(productImagesTable),
    db.select({ photoUrl: vehiclesTable.photoUrl }).from(vehiclesTable),
    db.select({ coverImage: accommodationsTable.coverImage, gallery: accommodationsTable.gallery }).from(accommodationsTable),
    db.select({ coverImage: destinationsTable.coverImage, gallery: destinationsTable.gallery }).from(destinationsTable),
    db.select({ photoUrl: clientsTable.photoUrl }).from(clientsTable),
    db.select({ avatarUrl: usersTable.avatarUrl }).from(usersTable),
  ]);

  const referencedKeys = new Set<string>();

  function addKey(url: string | null | undefined) {
    if (!url) return;
    const key = extractVerifiedUploadThingKey(url);
    if (key) referencedKeys.add(key);
  }

  for (const r of tenants) addKey(r.logoUrl);
  for (const r of stores) { addKey(r.logo); addKey(r.logoDark); addKey(r.favicon); addKey(r.bannerHome); addKey(r.bannerMobile); }
  for (const r of storeCategories) addKey(r.image);
  for (const r of storeProducts) { addKey(r.thumbnail); for (const url of r.images ?? []) addKey(url); for (const url of r.gallery ?? []) addKey(url); }
  for (const r of storeOrderItems) addKey(r.productImage);
  for (const r of storeReviews) { for (const url of r.images ?? []) addKey(url); }
  for (const r of trips) { addKey(r.coverImage); for (const url of r.gallery ?? []) addKey(url); }
  for (const r of productCategories) addKey(r.imageUrl);
  for (const r of productImages) addKey(r.url);
  for (const r of vehicles) addKey(r.photoUrl);
  for (const r of accommodations) { addKey(r.coverImage); for (const url of r.gallery ?? []) addKey(url); }
  for (const r of destinations) { addKey(r.coverImage); for (const url of r.gallery ?? []) addKey(url); }
  for (const r of clients) addKey(r.photoUrl);
  for (const r of users) addKey(r.avatarUrl);

  return referencedKeys;
}
