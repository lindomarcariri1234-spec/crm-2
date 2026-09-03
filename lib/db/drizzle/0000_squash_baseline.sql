me" text NOT NULL,
        "slug" text NOT NULL,
        "description" text,
        "monthly_price" numeric(10, 2) DEFAULT '0' NOT NULL,
        "annual_price" numeric(10, 2) DEFAULT '0' NOT NULL,
        "max_users" integer DEFAULT 5 NOT NULL,
        "max_clients" integer DEFAULT 100 NOT NULL,
        "max_trips" integer DEFAULT 20 NOT NULL,
        "features" json DEFAULT '[]'::json NOT NULL,
        "supported_features" json DEFAULT '[]'::json NOT NULL,
        "is_active" boolean DEFAULT true NOT NULL,
        "is_featured" boolean DEFAULT false NOT NULL,
        "sort_order" integer DEFAULT 0 NOT NULL,
        "trial_days" integer DEFAULT 0 NOT NULL,
        "payment_required" boolean DEFAULT false NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "plans_slug_unique" UNIQUE("slug")
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_settings" (
        "id" text PRIMARY KEY NOT NULL,
        "key" text NOT NULL,
        "value" text,
        "label" text NOT NULL,
        "description" text,
        "type" text DEFAULT 'string' NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "platform_settings_key_unique" UNIQUE("key")
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "plan_id" text NOT NULL,
        "status" text DEFAULT 'active' NOT NULL,
        "billing_cycle" text DEFAULT 'monthly' NOT NULL,
        "current_period_start" timestamp with time zone DEFAULT now() NOT NULL,
        "current_period_end" timestamp with time zone DEFAULT now() NOT NULL,
        "cancel_at_period_end" boolean DEFAULT false NOT NULL,
        "canceled_at" timestamp with time zone,
        "trial_end" timestamp with time zone,
        "trial_start" timestamp with time zone,
        "stripe_customer_id" text,
        "stripe_subscription_id" text,
        "external_id" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_tracking" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "subscription_id" text,
        "period_start" timestamp with time zone NOT NULL,
        "period_end" timestamp with time zone NOT NULL,
        "users_count" integer DEFAULT 0 NOT NULL,
        "clients_count" integer DEFAULT 0 NOT NULL,
        "trips_count" integer DEFAULT 0 NOT NULL,
        "recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_categories" (
        "id" text PRIMARY KEY NOT NULL,
        "store_id" text NOT NULL,
        "name" text NOT NULL,
        "slug" text NOT NULL,
        "description" text,
        "icon" text,
        "image" text,
        "parent_id" text,
        "meta_title" text,
        "meta_description" text,
        "order" integer DEFAULT 0 NOT NULL,
        "is_active" boolean DEFAULT true NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_coupons" (
        "id" text PRIMARY KEY NOT NULL,
        "store_id" text NOT NULL,
        "code" text NOT NULL,
        "type" text DEFAULT 'percentage' NOT NULL,
        "value" numeric(10, 2) NOT NULL,
        "description" text,
        "min_purchase_amount" numeric(10, 2),
        "max_discount_amount" numeric(10, 2),
        "usage_limit" integer,
        "usage_limit_per_customer" integer DEFAULT 1,
        "usage_count" integer DEFAULT 0 NOT NULL,
        "starts_at" timestamp with time zone NOT NULL,
        "expires_at" timestamp with time zone NOT NULL,
        "applicable_products" json DEFAULT '[]'::json NOT NULL,
        "applicable_categories" json DEFAULT '[]'::json NOT NULL,
        "minimum_items" integer,
        "is_active" boolean DEFAULT true NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_order_items" (
        "id" text PRIMARY KEY NOT NULL,
        "order_id" text NOT NULL,
        "product_id" text NOT NULL,
        "product_name" text NOT NULL,
        "product_type" text NOT NULL,
        "product_image" text,
        "variant" json,
        "price" numeric(10, 2) NOT NULL,
        "quantity" integer DEFAULT 1 NOT NULL,
        "subtotal" numeric(10, 2) NOT NULL,
        "discount" numeric(10, 2) DEFAULT '0' NOT NULL,
        "total" numeric(10, 2) NOT NULL,
        "metadata" json,
        "partner_id" text,
        "partner_product_id" text,
        "seller_name" text,
        "item_status" text DEFAULT 'pending' NOT NULL,
        "inventory_claimed_quantity" integer DEFAULT 0 NOT NULL,
        "inventory_state" text,
        "sales_count_applied" boolean DEFAULT false NOT NULL,
        "partner_capacity_claimed_quantity" integer DEFAULT 0 NOT NULL,
        "voucher_code" text,
        "cancellation_reason" text,
        "cancellation_requested_at" timestamp with time zone,
        "cancelled_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_orders" (
        "id" text PRIMARY KEY NOT NULL,
        "store_id" text NOT NULL,
        "tenant_id" text NOT NULL,
        "order_number" text NOT NULL,
        "idempotency_key" text,
        "client_id" text,
        "customer_name" text NOT NULL,
        "customer_email" text NOT NULL,
        "customer_phone" text NOT NULL,
        "customer_cpf" text,
        "customer_birthdate" date,
        "customer_address" json,
        "subtotal" numeric(10, 2) NOT NULL,
        "discount_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
        "tax_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
        "shipping_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
        "total_amount" numeric(10, 2) NOT NULL,
        "coupon_id" text,
        "coupon_code" text,
        "payment_method" text NOT NULL,
        "payment_provider" text NOT NULL,
        "payment_status" text DEFAULT 'pending' NOT NULL,
        "payment_intent_id" text,
        "payment_charge_id" text,
        "payment_token" text,
        "installments" integer DEFAULT 1 NOT NULL,
        "installment_amount" numeric(10, 2),
        "deposit_amount" numeric(10, 2),
        "amount_remaining" numeric(10, 2),
        "pix_qr_code" text,
        "pix_qr_code_url" text,
        "pix_copy_paste" text,
        "boleto_url" text,
        "boleto_barcode" text,
        "status" text DEFAULT 'pending' NOT NULL,
        "fulfillment_status" text DEFAULT 'unfulfilled' NOT NULL,
        "customer_notes" text,
        "internal_notes" text,
        "boarding_location_id" text,
        "seats" json,
        "co_passengers" json,
        "ip_address" text,
        "user_agent" text,
        "paid_at" timestamp with time zone,
        "confirmed_at" timestamp with time zone,
        "completed_at" timestamp with time zone,
        "cancelled_at" timestamp with time zone,
        "refunded_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        "pending_referral" json,
        "pending_credit_spend" json,
        "referral_effects_applied_at" timestamp with time zone,
        CONSTRAINT "store_orders_order_number_unique" UNIQUE("order_number")
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_pages" (
        "id" text PRIMARY KEY NOT NULL,
        "store_id" text NOT NULL,
        "title" text NOT NULL,
        "slug" text NOT NULL,
        "content" text DEFAULT '' NOT NULL,
        "meta_title" text,
        "meta_description" text,
        "is_published" boolean DEFAULT true NOT NULL,
        "show_in_menu" boolean DEFAULT false NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_products" (
        "id" text PRIMARY KEY NOT NULL,
        "store_id" text NOT NULL,
        "type" text NOT NULL,
        "name" text NOT NULL,
        "slug" text NOT NULL,
        "description" text DEFAULT '' NOT NULL,
        "short_description" text,
        "category_id" text,
        "price" numeric(10, 2) NOT NULL,
        "compare_price" numeric(10, 2),
        "cost_price" numeric(10, 2),
        "on_sale" boolean DEFAULT false NOT NULL,
        "sale_price" numeric(10, 2),
        "sale_starts_at" timestamp with time zone,
        "sale_ends_at" timestamp with time zone,
        "track_inventory" boolean DEFAULT true NOT NULL,
        "stock_quantity" integer,
        "allow_backorder" boolean DEFAULT false NOT NULL,
        "has_dates" boolean DEFAULT false NOT NULL,
        "start_date" timestamp with time zone,
        "end_date" timestamp with time zone,
        "images" json DEFAULT '[]'::json NOT NULL,
        "thumbnail" text,
        "gallery" json DEFAULT '[]'::json NOT NULL,
        "features" json DEFAULT '[]'::json NOT NULL,
        "includes" json DEFAULT '[]'::json NOT NULL,
        "excludes" json DEFAULT '[]'::json NOT NULL,
        "requirements" json DEFAULT '[]'::json NOT NULL,
        "destination" text,
        "duration_days" integer,
        "duration_nights" integer,
        "product_city" text,
        "product_state" text,
        "country" text DEFAULT 'Brasil',
        "has_variants" boolean DEFAULT false NOT NULL,
        "variants" json DEFAULT '[]'::json NOT NULL,
        "meta_title" text,
        "meta_description" text,
        "meta_keywords" text,
        "trip_id" text,
        "partner_product_id" text,
        "is_featured" boolean DEFAULT false NOT NULL,
        "order" integer DEFAULT 0 NOT NULL,
        "rating_average" numeric(3, 2),
        "rating_count" integer DEFAULT 0 NOT NULL,
        "status" text DEFAULT 'draft' NOT NULL,
        "published_at" timestamp with time zone,
        "views_count" integer DEFAULT 0 NOT NULL,
        "sales_count" integer DEFAULT 0 NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "store_products_trip_id_unique" UNIQUE("trip_id")
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_reviews" (
        "id" text PRIMARY KEY NOT NULL,
        "store_id" text NOT NULL,
        "product_id" text NOT NULL,
        "client_id" text,
        "reviewer_name" text NOT NULL,
        "reviewer_email" text NOT NULL,
        "rating" integer NOT NULL,
        "title" text,
        "comment" text,
        "images" json DEFAULT '[]'::json NOT NULL,
        "verified_purchase" boolean DEFAULT false NOT NULL,
        "status" text DEFAULT 'pending' NOT NULL,
        "is_featured" boolean DEFAULT false NOT NULL,
        "reply" text,
        "replied_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stores" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "name" text NOT NULL,
        "slug" text NOT NULL,
        "tagline" text,
        "description" text,
        "logo" text,
        "logo_dark" text,
        "favicon" text,
        "banner_home" text,
        "banner_mobile" text,
        "primary_color" text DEFAULT '#3b82f6' NOT NULL,
        "secondary_color" text DEFAULT '#10b981' NOT NULL,
        "accent_color" text DEFAULT '#f59e0b' NOT NULL,
        "custom_domain" text,
        "domain_verified" boolean DEFAULT false NOT NULL,
        "ssl_enabled" boolean DEFAULT false NOT NULL,
        "email" text NOT NULL,
        "phone" text,
        "whatsapp" text,
        "address" text,
        "city" text,
        "state" text,
        "zip_code" text,
        "facebook_url" text,
        "instagram_url" text,
        "twitter_url" text,
        "youtube_url" text,
        "linkedin_url" text,
        "tiktok_url" text,
        "meta_title" text,
        "meta_description" text,
        "meta_keywords" text,
        "google_analytics_id" text,
        "facebook_pixel_id" text,
        "google_tag_manager_id" text,
        "require_login" boolean DEFAULT false NOT NULL,
        "guest_checkout" boolean DEFAULT true NOT NULL,
        "min_installments" integer DEFAULT 1 NOT NULL,
        "max_installments" integer DEFAULT 12 NOT NULL,
        "installment_fee" numeric(5, 2) DEFAULT '0' NOT NULL,
        "min_order_value" numeric(10, 2),
        "min_deposit_amount" numeric(10, 2),
        "payment_methods" json DEFAULT '[]'::json NOT NULL,
        "stripe_enabled" boolean DEFAULT false NOT NULL,
        "stripe_public_key" text,
        "stripe_secret_key" text,
        "stripe_webhook_secret" text,
        "mp_enabled" boolean DEFAULT false NOT NULL,
        "mp_public_key" text,
        "mp_access_token" text,
        "pix_enabled" boolean DEFAULT false NOT NULL,
        "pix_key" text,
        "pix_key_type" text,
        "boleto_enabled" boolean DEFAULT false NOT NULL,
        "terms_of_service" text,
        "privacy_policy" text,
        "refund_policy" text,
        "cancellation_policy" text,
        "terms_url" text,
        "privacy_url" text,
        "notification_email" text,
        "order_notification_enabled" boolean DEFAULT true NOT NULL,
        "is_active" boolean DEFAULT true NOT NULL,
        "maintenance_mode" boolean DEFAULT false NOT NULL,
        "maintenance_message" text,
        "total_orders" integer DEFAULT 0 NOT NULL,
        "total_revenue" numeric(12, 2) DEFAULT '0' NOT NULL,
        "total_visits" integer DEFAULT 0 NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "stores_tenant_id_unique" UNIQUE("tenant_id"),
        CONSTRAINT "stores_slug_unique" UNIQUE("slug"),
        CONSTRAINT "stores_custom_domain_unique" UNIQUE("custom_domain")
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invites" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "email" text NOT NULL,
        "role" text DEFAULT 'vendedor' NOT NULL,
        "invited_by" text,
        "token" text NOT NULL,
        "accepted" boolean DEFAULT false NOT NULL,
        "accepted_at" timestamp with time zone,
        "expires_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "invites_token_unique" UNIQUE("token")
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_logs" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "reservation_id" text,
        "referral_id" text,
        "recipient" text NOT NULL,
        "subject" text NOT NULL,
        "status" text NOT NULL,
        "message_id" text,
        "error_message" text,
        "is_auto_retry" boolean DEFAULT false NOT NULL,
        "retries_exhausted_at" timestamp with time zone,
        "retries_resolved_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "birthday_messages" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "client_id" text NOT NULL,
        "birthday_year" integer NOT NULL,
        "sent_whatsapp" boolean DEFAULT false NOT NULL,
        "sent_email" boolean DEFAULT false NOT NULL,
        "whatsapp_sent_at" timestamp with time zone,
        "email_sent_at" timestamp with time zone,
        "whatsapp_error" text,
        "email_error" text,
        "coupon_id" text,
        "coupon_code" text,
        "email_opened" boolean DEFAULT false NOT NULL,
        "email_opened_at" timestamp with time zone,
        "converted" boolean DEFAULT false NOT NULL,
        "is_manual" boolean DEFAULT false NOT NULL,
        "sent_by_id" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle_layouts" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "name" text NOT NULL,
        "description" text,
        "vehicle_type" text,
        "rows" integer DEFAULT 12 NOT NULL,
        "cols" integer DEFAULT 4 NOT NULL,
        "floors" integer DEFAULT 1 NOT NULL,
        "numbering_type" text DEFAULT 'sequential' NOT NULL,
        "cells" json DEFAULT '[]'::json NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_goals" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "user_id" text NOT NULL,
        "period_type" text DEFAULT 'monthly' NOT NULL,
        "year" integer,
        "month" text,
        "month_int" integer,
        "quarter" integer,
        "goal_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
        "achieved_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
        "goal_quantity" numeric(10, 0),
        "achieved_quantity" numeric(10, 0) DEFAULT '0',
        "progress_percentage" numeric(5, 2) DEFAULT '0',
        "bonus_amount" numeric(10, 2),
        "bonus_paid" boolean DEFAULT false NOT NULL,
        "status" text DEFAULT 'active' NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "calendar_events" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "user_id" text,
        "client_id" text,
        "trip_id" text,
        "payment_id" text,
        "google_event_id" text NOT NULL,
        "calendar_id" text DEFAULT 'primary' NOT NULL,
        "event_type" text NOT NULL,
        "title" text NOT NULL,
        "description" text,
        "start_date" timestamp with time zone NOT NULL,
        "end_date" timestamp with time zone,
        "location" text,
        "synced_at" timestamp with time zone DEFAULT now() NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "redis_alert_log" (
        "id" text PRIMARY KEY NOT NULL,
        "event_type" text NOT NULL,
        "alert_status" text,
        "email_to" text,
        "triggered_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trip_costs" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "trip_id" text NOT NULL,
        "category" text NOT NULL,
        "description" text NOT NULL,
        "supplier_id" text,
        "supplier_name" text,
        "amount" numeric(10, 2) NOT NULL,
        "status" text DEFAULT 'pending' NOT NULL,
        "due_date" timestamp with time zone,
        "paid_at" timestamp with time zone,
        "notes" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_notifications" (
        "id" text PRIMARY KEY NOT NULL,
        "client_id" text NOT NULL,
        "tenant_id" text NOT NULL,
        "type" text NOT NULL,
        "payload" jsonb,
        "read_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_notification_outbox" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "reservation_id" text NOT NULL,
        "type" text NOT NULL,
        "status" text DEFAULT 'pending' NOT NULL,
        "enqueued_at" timestamp with time zone,
        "sent_at" timestamp with time zone,
        "last_error" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "whatsapp_notification_outbox_reservation_type_unique" UNIQUE("tenant_id","reservation_id","type")
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_nps_responses" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "client_id" text NOT NULL,
        "reservation_id" text NOT NULL,
        "trip_id" text,
        "score" integer NOT NULL,
        "score_transport" integer,
        "score_service" integer,
        "score_organization" integer,
        "score_guide" integer,
        "comment" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "client_nps_responses_reservation_id_unique" UNIQUE("reservation_id")
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nps_invitations" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "client_id" text NOT NULL,
        "reservation_id" text NOT NULL,
        "trip_id" text,
        "token" text NOT NULL,
        "invited_at" timestamp with time zone DEFAULT now() NOT NULL,
        "responded_at" timestamp with time zone,
        CONSTRAINT "nps_invitations_token_unique" UNIQUE("token"),
        CONSTRAINT "nps_invitations_reservation_id_unique" UNIQUE("reservation_id")
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_favorites" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "client_id" text NOT NULL,
        "item_type" text NOT NULL,
        "item_id" text NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "low_availability_notified_at" timestamp with time zone
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_integration_logs" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "event" text NOT NULL,
        "level" text DEFAULT 'info' NOT NULL,
        "message" text NOT NULL,
        "actor_id" text,
        "actor_name" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_integrations" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "name" text,
        "provider" text DEFAULT 'openai' NOT NULL,
        "api_key_encrypted" text,
        "access_token_encrypted" text,
        "base_url" text,
        "default_model" text,
        "environment" text DEFAULT 'production' NOT NULL,
        "enabled" boolean DEFAULT false NOT NULL,
        "status" text DEFAULT 'disconnected' NOT NULL,
        "last_error" text,
        "last_sync_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "ai_integrations_tenant_id_unique" UNIQUE("tenant_id")
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_integration_logs" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "type" text NOT NULL,
        "event" text NOT NULL,
        "level" text DEFAULT 'info' NOT NULL,
        "message" text NOT NULL,
        "actor_id" text,
        "actor_name" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_integrations" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "type" text NOT NULL,
        "name" text,
        "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "secrets_encrypted" text,
        "environment" text DEFAULT 'production' NOT NULL,
        "enabled" boolean DEFAULT false NOT NULL,
        "status" text DEFAULT 'disconnected' NOT NULL,
        "last_error" text,
        "last_sync_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "tenant_integrations_tenant_type_uq" UNIQUE("tenant_id","type")
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_achievements" (
        "id" text PRIMARY KEY NOT NULL,
        "client_id" text NOT NULL,
        "tenant_id" text NOT NULL,
        "badge_key" text NOT NULL,
        "earned_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "client_achievements_unique_badge" UNIQUE("client_id","tenant_id","badge_key")
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_dream_destinations" (
        "id" text PRIMARY KEY NOT NULL,
        "client_id" text NOT NULL,
        "tenant_id" text NOT NULL,
        "destination_name" text NOT NULL,
        "note" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trip_media" (
        "id" text PRIMARY KEY NOT NULL,
        "trip_id" text NOT NULL,
        "tenant_id" text NOT NULL,
        "url" text NOT NULL,
        "type" text DEFAULT 'image' NOT NULL,
        "caption" text,
        "uploaded_by_user_id" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_scores" (
        "id" text PRIMARY KEY NOT NULL,
        "client_id" text NOT NULL,
        "tenant_id" text NOT NULL,
        "purchase_score" integer DEFAULT 0 NOT NULL,
        "recompra_score" integer DEFAULT 0 NOT NULL,
        "churn_score" integer DEFAULT 0 NOT NULL,
        "nbo_trip_id" text,
        "nbo_reasoning" text,
        "rfm_r" integer,
        "rfm_f" integer,
        "rfm_m" numeric(12, 2),
        "calculated_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "club_benefits" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "tier" text NOT NULL,
        "benefit_key" text NOT NULL,
        "label" text NOT NULL,
        "description" text,
        "value" text,
        "sort_order" integer DEFAULT 0 NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "club_config" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "club_name" text DEFAULT 'Clube Visite' NOT NULL,
        "description" text,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "partner_availability" (
        "id" text PRIMARY KEY NOT NULL,
        "product_id" text NOT NULL,
        "date" text NOT NULL,
        "spots_total" integer DEFAULT 10 NOT NULL,
        "spots_used" integer DEFAULT 0 NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "partner_commissions" (
        "id" text PRIMARY KEY NOT NULL,
        "order_id" text NOT NULL,
        "partner_id" text NOT NULL,
        "tenant_id" text NOT NULL,
        "gross_amount" numeric(10, 2) NOT NULL,
        "partner_amount" numeric(10, 2) NOT NULL,
        "agency_amount" numeric(10, 2) NOT NULL,
        "status" text DEFAULT 'pending' NOT NULL,
        "period" text NOT NULL,
        "paid_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "partner_products" (
        "id" text PRIMARY KEY NOT NULL,
        "partner_id" text NOT NULL,
        "tenant_id" text NOT NULL,
        "type" text DEFAULT 'passeio' NOT NULL,
        "title" text NOT NULL,
        "slug" text NOT NULL,
        "description" text,
        "origin" text,
        "price" numeric(10, 2) DEFAULT '0' NOT NULL,
        "max_capacity" integer DEFAULT 10 NOT NULL,
        "duration_minutes" integer,
        "meeting_point" text,
        "location_url" text,
        "cancellation_policy" text,
        "faq" json DEFAULT '[]'::json NOT NULL,
        "images" json DEFAULT '[]'::json NOT NULL,
        "status" text DEFAULT 'pending' NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "partners" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "name" text NOT NULL,
        "email" text NOT NULL,
        "cnpj" text,
        "slug" text NOT NULL,
        "description" text,
        "phone" text,
        "logo" text,
        "status" text DEFAULT 'pending' NOT NULL,
        "commission_pct" numeric(5, 2) DEFAULT '30' NOT NULL,
        "referral_commission_eligible" boolean DEFAULT false NOT NULL,
        "password_hash" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trip_checkins" (
        "id" text PRIMARY KEY NOT NULL,
        "trip_id" text NOT NULL,
        "tenant_id" text NOT NULL,
        "passenger_id" text NOT NULL,
        "reservation_id" text,
        "checked_in_by_user_ref" text,
        "checked_in_at" timestamp with time zone DEFAULT now() NOT NULL,
        "notes" text,
        "status" text DEFAULT 'present' NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trip_guide_locations" (
        "trip_id" text NOT NULL,
        "tenant_id" text NOT NULL,
        "guide_user_ref" text,
        "guide_name" text,
        "lat" numeric(10, 6) NOT NULL,
        "lng" numeric(10, 6) NOT NULL,
        "recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trip_guide_tokens" (
        "id" text PRIMARY KEY NOT NULL,
        "trip_id" text NOT NULL,
        "tenant_id" text NOT NULL,
        "guide_name" text NOT NULL,
        "token" text NOT NULL,
        "expires_at" timestamp with time zone NOT NULL,
        "created_by_user_id" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gemeo_alerts" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "message" text NOT NULL,
        "category" text NOT NULL,
        "severity" text DEFAULT 'medium' NOT NULL,
        "action_url" text,
        "dismissed_at" timestamp with time zone,
        "generated_at" timestamp with time zone DEFAULT now() NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gemeo_opportunities" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "title" text NOT NULL,
        "description" text,
        "action_url" text,
        "generated_at" timestamp with time zone DEFAULT now() NOT NULL,
        "dismissed_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clients" ADD CONSTRAINT "clients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trips" ADD CONSTRAINT "trips_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "passengers" ADD CONSTRAINT "passengers_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reservation_installments" ADD CONSTRAINT "reservation_installments_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reservation_installments" ADD CONSTRAINT "reservation_installments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reservations" ADD CONSTRAINT "reservations_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reservations" ADD CONSTRAINT "reservations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reservations" ADD CONSTRAINT "reservations_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reservations" ADD CONSTRAINT "reservations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expenses" ADD CONSTRAINT "expenses_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deals" ADD CONSTRAINT "deals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deals" ADD CONSTRAINT "deals_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deals" ADD CONSTRAINT "deals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deals" ADD CONSTRAINT "deals_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deals" ADD CONSTRAINT "deals_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_categories" ADD CONSTRAINT "store_categories_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_coupons" ADD CONSTRAINT "store_coupons_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_order_items" ADD CONSTRAINT "store_order_items_order_id_store_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."store_orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_order_items" ADD CONSTRAINT "store_order_items_product_id_store_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."store_products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_pages" ADD CONSTRAINT "store_pages_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_products" ADD CONSTRAINT "store_products_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_products" ADD CONSTRAINT "store_products_category_id_store_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."store_categories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_products" ADD CONSTRAINT "store_products_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_reviews" ADD CONSTRAINT "store_reviews_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_reviews" ADD CONSTRAINT "store_reviews_product_id_store_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."store_products"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_reviews" ADD CONSTRAINT "store_reviews_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stores" ADD CONSTRAINT "stores_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invites" ADD CONSTRAINT "invites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle_layouts" ADD CONSTRAINT "vehicle_layouts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_goals" ADD CONSTRAINT "sales_goals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_goals" ADD CONSTRAINT "sales_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trip_costs" ADD CONSTRAINT "trip_costs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trip_costs" ADD CONSTRAINT "trip_costs_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_notifications" ADD CONSTRAINT "client_notifications_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_nps_responses" ADD CONSTRAINT "client_nps_responses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_nps_responses" ADD CONSTRAINT "client_nps_responses_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "nps_invitations" ADD CONSTRAINT "nps_invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "nps_invitations" ADD CONSTRAINT "nps_invitations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_favorites" ADD CONSTRAINT "client_favorites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_favorites" ADD CONSTRAINT "client_favorites_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_integration_logs" ADD CONSTRAINT "ai_integration_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_integrations" ADD CONSTRAINT "ai_integrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_integration_logs" ADD CONSTRAINT "tenant_integration_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_integrations" ADD CONSTRAINT "tenant_integrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_achievements" ADD CONSTRAINT "client_achievements_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_achievements" ADD CONSTRAINT "client_achievements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_dream_destinations" ADD CONSTRAINT "client_dream_destinations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_dream_destinations" ADD CONSTRAINT "client_dream_destinations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trip_media" ADD CONSTRAINT "trip_media_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trip_media" ADD CONSTRAINT "trip_media_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_scores" ADD CONSTRAINT "client_scores_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_scores" ADD CONSTRAINT "client_scores_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_scores" ADD CONSTRAINT "client_scores_nbo_trip_id_trips_id_fk" FOREIGN KEY ("nbo_trip_id") REFERENCES "public"."trips"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "club_benefits" ADD CONSTRAINT "club_benefits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "club_config" ADD CONSTRAINT "club_config_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "partner_availability" ADD CONSTRAINT "partner_availability_product_id_partner_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."partner_products"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "partner_commissions" ADD CONSTRAINT "partner_commissions_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "partner_commissions" ADD CONSTRAINT "partner_commissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "partner_products" ADD CONSTRAINT "partner_products_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "partner_products" ADD CONSTRAINT "partner_products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "partners" ADD CONSTRAINT "partners_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trip_checkins" ADD CONSTRAINT "trip_checkins_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trip_checkins" ADD CONSTRAINT "trip_checkins_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trip_guide_locations" ADD CONSTRAINT "trip_guide_locations_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trip_guide_locations" ADD CONSTRAINT "trip_guide_locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trip_guide_tokens" ADD CONSTRAINT "trip_guide_tokens_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trip_guide_tokens" ADD CONSTRAINT "trip_guide_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gemeo_alerts" ADD CONSTRAINT "gemeo_alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gemeo_opportunities" ADD CONSTRAINT "gemeo_opportunities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "clients_tenant_cpf_unique" ON "clients" USING btree ("tenant_id","cpf") WHERE "clients"."cpf" IS NOT NULL;;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "clients_tenant_referral_code_unique" ON "clients" USING btree ("tenant_id","referral_code") WHERE "clients"."referral_code" IS NOT NULL;;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "clients_customer_code_unique" ON "clients" USING btree ("customer_code") WHERE "clients"."customer_code" IS NOT NULL;;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_sends_unique" ON "campaign_sends" USING btree ("campaign_id","client_id");;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_orders_store_idempotency_key_unique" ON "store_orders" USING btree ("store_id","idempotency_key");;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_sends_tenant_idx" ON "campaign_sends" USING btree ("tenant_id","sent_at");;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_logs_retries_exhausted_idx" ON "email_logs" USING btree ("tenant_id","reservation_id") WHERE "email_logs"."retries_exhausted_at" IS NOT NULL;;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_events_tenant_idx" ON "calendar_events" USING btree ("tenant_id");;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_events_user_idx" ON "calendar_events" USING btree ("user_id");;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_events_google_event_idx" ON "calendar_events" USING btree ("google_event_id");;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_events_trip_idx" ON "calendar_events" USING btree ("trip_id");;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_events_payment_idx" ON "calendar_events" USING btree ("payment_id");;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_notifications_client_id_idx" ON "client_notifications" USING btree ("client_id","created_at");;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_notifications_unread_idx" ON "client_notifications" USING btree ("client_id","created_at") WHERE read_at IS NULL;;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_nps_client_id_idx" ON "client_nps_responses" USING btree ("client_id","created_at");;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_nps_tenant_id_idx" ON "client_nps_responses" USING btree ("tenant_id","created_at");;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nps_inv_tenant_idx" ON "nps_invitations" USING btree ("tenant_id","invited_at");;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_favorites_unique_idx" ON "client_favorites" USING btree ("client_id","item_type","item_id");;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_favorites_client_idx" ON "client_favorites" USING btree ("client_id","created_at");;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_integration_logs_tenant_idx" ON "ai_integration_logs" USING btree ("tenant_id","created_at");;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_integration_logs_tenant_idx" ON "tenant_integration_logs" USING btree ("tenant_id","type","created_at");;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_achievements_tenant_client_idx" ON "client_achievements" USING btree ("tenant_id","client_id");;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_dream_destinations_tenant_client_idx" ON "client_dream_destinations" USING btree ("tenant_id","client_id");;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trip_media_trip_idx" ON "trip_media" USING btree ("trip_id","created_at");;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trip_media_tenant_idx" ON "trip_media" USING btree ("tenant_id");;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_scores_client_tenant_unique" ON "client_scores" USING btree ("client_id","tenant_id");;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_scores_tenant_idx" ON "client_scores" USING btree ("tenant_id","calculated_at");;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "club_benefits_tenant_tier_idx" ON "club_benefits" USING btree ("tenant_id","tier");;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "club_config_tenant_unique" ON "club_config" USING btree ("tenant_id");;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trip_guide_locations_pkey_idx" ON "trip_guide_locations" USING btree ("trip_id","tenant_id");;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trip_guide_tokens_token_uniq" ON "trip_guide_tokens" USING btree ("token");;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gemeo_alerts_tenant_idx" ON "gemeo_alerts" USING btree ("tenant_id","generated_at");;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gemeo_opportunities_tenant_idx" ON "gemeo_opportunities" USING btree ("tenant_id","generated_at");;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "insights_chat_history" (
        "id" text PRIMARY KEY NOT NULL,
        "tenant_id" text NOT NULL,
        "user_id" text NOT NULL,
        "chat_type" text NOT NULL,
        "messages" json DEFAULT '[]' NOT NULL,
        "updated_at" timestamptz DEFAULT now() NOT NULL,
        CONSTRAINT "insights_chat_history_unique" UNIQUE("tenant_id","user_id","chat_type")
);;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stripe_webhook_events" (
        "id" text PRIMARY KEY NOT NULL,
        "type" text,
        "status" text DEFAULT 'processing' NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "processed_at" timestamp with time zone
);;