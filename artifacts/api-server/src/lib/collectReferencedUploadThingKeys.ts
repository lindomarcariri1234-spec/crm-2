/**
 * collectReferencedUploadThingKeys.ts
 *
 * Returns the set of every UploadThing file key that is currently referenced by
 * at least one row in the database.  This is used by:
 *   - POST /admin/cleanup-orphaned-uploadthing-files  (super-admin endpoint)
 *   - POST /admin/maintenance/orphaned-files          (super-admin endpoint)
 *   - lib/uploadthing-orphan-cleanup.ts               (nightly cron job)
 *
 * COVERAGE CONTRACT
 * -----------------
 * Every DB table/column that may hold an UploadThing URL or file key MUST be
 * listed here.  A column not in this list causes the cleanup job to treat its
 * files as orphans and delete them.  When you add a new media-bearing column,
 * add it to this function AND add a test in the caller's test suite.
 *
 * Currently covered tables and columns:
 *   tenants.logo_url
 *   users.avatar_url
 *   clients.photo_url
 *   vehicles.photo_url
 *   accommodations.cover_image, gallery[]
 *   destinations.cover_image, gallery[]
 *   trips.cover_image, gallery[], videos[]
 *   trip_media.url
 *   documents.url, file_key
 *   campaigns.media_url
 *   messages.media_url
 *   chatbot_messages.media_url
 *   payments.receipt_url
 *   expenses.receipt_url
 *   partners.logo
 *   partner_products.images[]
 *   product_categories.image_url
 *   product_images.url
 *   stores.logo, logo_dark, favicon, banner_home, banner_mobile
 *   store_categories.image
 *   store_products.thumbnail, images[], gallery[]
 *   store_order_items.product_image
 *   store_reviews.images[]
 */

import {
  db,
  tenantsTable,
  usersTable,
  clientsTable,
  vehiclesTable,
  accommodationsTable,
  destinationsTable,
  tripsTable,
  tripMediaTable,
  documentsTable,
  campaignsTable,
  messagesTable,
  chatbotMessagesTable,
  paymentsTable,
  expensesTable,
  partnersTable,
  partnerProductsTable,
  productCategoriesTable,
  productImagesTable,
  storesTable,
  storeCategoriesTable,
  storeProductsTable,
  storeOrderItemsTable,
  storeReviewsTable,
} from "@workspace/db";
import { extractVerifiedUploadThingKey } from "./uploadthing";

export async function collectReferencedUploadThingKeys(): Promise<Set<string>> {
  const [
    tenants,
    users,
    clients,
    vehicles,
    accommodations,
    destinations,
    trips,
    tripMedia,
    documents,
    campaigns,
    messages,
    chatbotMessages,
    payments,
    expenses,
    partners,
    partnerProducts,
    productCategories,
    productImages,
    stores,
    storeCategories,
    storeProducts,
    storeOrderItems,
    storeReviews,
  ] = await Promise.all([
    db.select({ logoUrl: tenantsTable.logoUrl }).from(tenantsTable),
    db.select({ avatarUrl: usersTable.avatarUrl }).from(usersTable),
    db.select({ photoUrl: clientsTable.photoUrl }).from(clientsTable),
    db.select({ photoUrl: vehiclesTable.photoUrl }).from(vehiclesTable),
    db.select({ coverImage: accommodationsTable.coverImage, gallery: accommodationsTable.gallery }).from(accommodationsTable),
    db.select({ coverImage: destinationsTable.coverImage, gallery: destinationsTable.gallery }).from(destinationsTable),
    db.select({ coverImage: tripsTable.coverImage, gallery: tripsTable.gallery, videos: tripsTable.videos }).from(tripsTable),
    db.select({ url: tripMediaTable.url }).from(tripMediaTable),
    db.select({ url: documentsTable.url, fileKey: documentsTable.fileKey }).from(documentsTable),
    db.select({ mediaUrl: campaignsTable.mediaUrl }).from(campaignsTable),
    db.select({ mediaUrl: messagesTable.mediaUrl }).from(messagesTable),
    db.select({ mediaUrl: chatbotMessagesTable.mediaUrl }).from(chatbotMessagesTable),
    db.select({ receiptUrl: paymentsTable.receiptUrl }).from(paymentsTable),
    db.select({ receiptUrl: expensesTable.receiptUrl }).from(expensesTable),
    db.select({ logo: partnersTable.logo }).from(partnersTable),
    db.select({ images: partnerProductsTable.images }).from(partnerProductsTable),
    db.select({ imageUrl: productCategoriesTable.imageUrl }).from(productCategoriesTable),
    db.select({ url: productImagesTable.url }).from(productImagesTable),
    db.select({ logo: storesTable.logo, logoDark: storesTable.logoDark, favicon: storesTable.favicon, bannerHome: storesTable.bannerHome, bannerMobile: storesTable.bannerMobile }).from(storesTable),
    db.select({ image: storeCategoriesTable.image }).from(storeCategoriesTable),
    db.select({ images: storeProductsTable.images, thumbnail: storeProductsTable.thumbnail, gallery: storeProductsTable.gallery }).from(storeProductsTable),
    db.select({ productImage: storeOrderItemsTable.productImage }).from(storeOrderItemsTable),
    db.select({ images: storeReviewsTable.images }).from(storeReviewsTable),
  ]);

  const referencedKeys = new Set<string>();

  function addKey(url: string | null | undefined): void {
    if (!url) return;
    const key = extractVerifiedUploadThingKey(url);
    if (key) referencedKeys.add(key);
  }

  function addArrayKeys(urls: string[] | null | undefined): void {
    for (const url of urls ?? []) addKey(url);
  }

  for (const r of tenants) addKey(r.logoUrl);
  for (const r of users) addKey(r.avatarUrl);
  for (const r of clients) addKey(r.photoUrl);
  for (const r of vehicles) addKey(r.photoUrl);
  for (const r of accommodations) { addKey(r.coverImage); addArrayKeys(r.gallery); }
  for (const r of destinations) { addKey(r.coverImage); addArrayKeys(r.gallery); }
  for (const r of trips) { addKey(r.coverImage); addArrayKeys(r.gallery); addArrayKeys(r.videos); }
  for (const r of tripMedia) addKey(r.url);
  for (const r of documents) { addKey(r.url); if (r.fileKey) referencedKeys.add(r.fileKey); }
  for (const r of campaigns) addKey(r.mediaUrl);
  for (const r of messages) addKey(r.mediaUrl);
  for (const r of chatbotMessages) addKey(r.mediaUrl);
  for (const r of payments) addKey(r.receiptUrl);
  for (const r of expenses) addKey(r.receiptUrl);
  for (const r of partners) addKey(r.logo);
  for (const r of partnerProducts) addArrayKeys(r.images as string[]);
  for (const r of productCategories) addKey(r.imageUrl);
  for (const r of productImages) addKey(r.url);
  for (const r of stores) { addKey(r.logo); addKey(r.logoDark); addKey(r.favicon); addKey(r.bannerHome); addKey(r.bannerMobile); }
  for (const r of storeCategories) addKey(r.image);
  for (const r of storeProducts) { addKey(r.thumbnail); addArrayKeys(r.images as string[]); addArrayKeys(r.gallery as string[]); }
  for (const r of storeOrderItems) addKey(r.productImage);
  for (const r of storeReviews) addArrayKeys(r.images as string[]);

  return referencedKeys;
}
