CREATE TABLE IF NOT EXISTS "pms_payment_adjustments" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "reservation_id" text NOT NULL,
  "adjusted_by_id" text,
  "previous_paid_amount" numeric(12, 2) NOT NULL,
  "new_paid_amount" numeric(12, 2) NOT NULL,
  "delta_amount" numeric(12, 2) NOT NULL,
  "reason" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pms_payment_adjustments_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade,
  CONSTRAINT "pms_payment_adjustments_reservation_id_pms_reservations_id_fk"
    FOREIGN KEY ("reservation_id") REFERENCES "public"."pms_reservations"("id") ON DELETE cascade,
  CONSTRAINT "pms_payment_adjustments_adjusted_by_id_users_id_fk"
    FOREIGN KEY ("adjusted_by_id") REFERENCES "public"."users"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pms_payment_adjustments_tenant_reservation_idx"
  ON "pms_payment_adjustments" USING btree ("tenant_id", "reservation_id", "created_at");