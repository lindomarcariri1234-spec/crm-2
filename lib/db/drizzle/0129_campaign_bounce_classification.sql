ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "permanent_bounced_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "temporary_bounced_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "campaign_sends"
  ADD COLUMN IF NOT EXISTS "bounce_type" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_deliveries_bounce_backfill_idx"
  ON "outbound_deliveries" USING btree ("tenant_id", "outbound_message_id", "bounce_type")
  WHERE "provider" = 'resend'
    AND "channel" = 'email'
    AND "bounce_type" IN ('permanent', 'temporary');
--> statement-breakpoint
WITH classified_sends AS (
  SELECT
    od."tenant_id",
    om."metadata" ->> 'campaignId' AS "campaign_id",
    om."metadata" ->> 'campaignSendId' AS "campaign_send_id",
    min(od."bounce_type") AS "bounce_type"
  FROM "outbound_deliveries" od
  JOIN "outbound_messages" om
    ON om."id" = od."outbound_message_id"
    AND om."tenant_id" = od."tenant_id"
  JOIN "campaigns" c
    ON c."id" = (om."metadata" ->> 'campaignId')
    AND c."tenant_id" = od."tenant_id"
  WHERE od."provider" = 'resend'
    AND od."channel" = 'email'
    AND od."bounce_type" IN ('permanent', 'temporary')
    AND om."origin" = 'campaign'
    AND c."failure_tracking_started_at" IS NOT NULL
    AND NULLIF(om."metadata" ->> 'campaignSendId', '') IS NOT NULL
  GROUP BY
    od."tenant_id",
    om."metadata" ->> 'campaignId',
    om."metadata" ->> 'campaignSendId'
  HAVING count(DISTINCT od."bounce_type") = 1
)
UPDATE "campaign_sends" cs
SET "bounce_type" = classified_sends."bounce_type"
FROM classified_sends
WHERE cs."id" = classified_sends."campaign_send_id"
  AND cs."campaign_id" = classified_sends."campaign_id"
  AND cs."tenant_id" = classified_sends."tenant_id"
  AND cs."bounced_at" IS NOT NULL
  AND cs."bounce_type" IS NULL;
--> statement-breakpoint
WITH campaign_bounce_counts AS (
  SELECT
    cs."tenant_id",
    cs."campaign_id",
    count(*) FILTER (WHERE cs."bounce_type" = 'permanent')::integer AS "permanent_bounced_count",
    count(*) FILTER (WHERE cs."bounce_type" = 'temporary')::integer AS "temporary_bounced_count"
  FROM "campaign_sends" cs
  JOIN "campaigns" c
    ON c."id" = cs."campaign_id"
    AND c."tenant_id" = cs."tenant_id"
  WHERE cs."bounced_at" IS NOT NULL
    AND c."failure_tracking_started_at" IS NOT NULL
  GROUP BY cs."tenant_id", cs."campaign_id"
)
UPDATE "campaigns" c
SET
  "permanent_bounced_count" = campaign_bounce_counts."permanent_bounced_count",
  "temporary_bounced_count" = campaign_bounce_counts."temporary_bounced_count"
FROM campaign_bounce_counts
WHERE c."id" = campaign_bounce_counts."campaign_id"
  AND c."tenant_id" = campaign_bounce_counts."tenant_id";
