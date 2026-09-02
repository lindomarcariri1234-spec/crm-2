CREATE INDEX IF NOT EXISTS "expenses_financial_due_idx" ON "expenses" USING btree ("tenant_id","status","due_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_financial_paid_idx" ON "expenses" USING btree ("tenant_id","status","payment_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_financial_paid_idx" ON "payments" USING btree ("tenant_id","type","status","paid_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_financial_due_idx" ON "payments" USING btree ("tenant_id","type","status","due_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referral_commissions_financial_created_idx" ON "referral_commissions" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referral_commissions_financial_paid_idx" ON "referral_commissions" USING btree ("tenant_id","status","paid_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referrals_financial_bonus_paid_idx" ON "referrals" USING btree ("tenant_id","status","bonus_paid_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referrals_financial_credit_used_idx" ON "referrals" USING btree ("tenant_id","status","bonus_credit_used_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commissions_financial_created_idx" ON "commissions" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commissions_financial_paid_idx" ON "commissions" USING btree ("tenant_id","status","paid_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trip_costs_financial_created_idx" ON "trip_costs" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trip_costs_financial_due_idx" ON "trip_costs" USING btree ("tenant_id","status","due_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trip_costs_financial_paid_idx" ON "trip_costs" USING btree ("tenant_id","status","paid_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_ledger_tenant_occurred_idx" ON "financial_ledger_entries" USING btree ("tenant_id","occurred_at"); 