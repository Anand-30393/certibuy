-- Portable PostgreSQL: constraints Prisma cannot express, ledger protection and row-level security.
-- docs/architecture.md §6–§7, docs/roles.md.txt §6. No Supabase-specific objects here
-- (those live in packages/db/supabase/).

-- ------------------------------------------------------------------ singleton settings
ALTER TABLE "settings" ADD CONSTRAINT "settings_singleton" CHECK ("id" = 1);

-- ------------------------------------------------------------------ partial unique indexes
-- One balance payout per device.
CREATE UNIQUE INDEX "payouts_one_balance_per_device"
  ON "payouts" ("device_id") WHERE "type" = 'balance';
-- At most one escrow release and one refund per order.
CREATE UNIQUE INDEX "escrow_one_release_per_order"
  ON "escrow_transactions" ("order_id") WHERE "type" = 'release';
CREATE UNIQUE INDEX "escrow_one_refund_per_order"
  ON "escrow_transactions" ("order_id") WHERE "type" IN ('refund_full', 'refund_partial');
-- One open return per order.
CREATE UNIQUE INDEX "returns_one_open_per_order"
  ON "return_requests" ("order_id") WHERE "status" <> 'resolved';
-- Exactly one current liquidity score per model.
CREATE UNIQUE INDEX "liquidity_one_current_per_model"
  ON "liquidity_scores" ("device_model_id") WHERE "is_current";
-- One live listing per device.
CREATE UNIQUE INDEX "listings_one_live_per_device"
  ON "listings" ("device_id") WHERE "status" IN ('active', 'reserved', 'review');
-- One live booking per submission.
CREATE UNIQUE INDEX "bookings_one_live_per_submission"
  ON "bookings" ("submission_id") WHERE "status" = 'booked';

-- ------------------------------------------------------------------ value checks
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_amount_positive" CHECK ("amount" >= 0);
ALTER TABLE "escrow_transactions" ADD CONSTRAINT "escrow_amount_positive" CHECK ("amount" >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_total_positive" CHECK ("total" >= 0);
ALTER TABLE "listings" ADD CONSTRAINT "listings_prices_positive"
  CHECK ("base_price" >= 0 AND "current_price" >= 0 AND "floor_price" >= 0);
ALTER TABLE "devices" ADD CONSTRAINT "devices_tag_format" CHECK ("tag_id" ~ '^CB-[0-9]{5}$');
ALTER TABLE "support_requests" ADD CONSTRAINT "support_message_length"
  CHECK (char_length("message") BETWEEN 10 AND 1000);

-- ------------------------------------------------------------------ "who is calling" shim
-- RLS policies call app.current_user_id(). Portable default: a per-transaction setting.
-- Supabase redefines it as auth.uid() (packages/db/supabase/001_supabase.sql).
CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;

CREATE OR REPLACE FUNCTION app.current_app_role() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_role::text FROM public.profiles WHERE id = app.current_user_id()
$$;

CREATE OR REPLACE FUNCTION app.is_ops() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT app_role = 'ops' OR is_platform_admin FROM public.profiles WHERE id = app.current_user_id()),
    false)
$$;

CREATE OR REPLACE FUNCTION app.current_hub_id() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT hub_id FROM public.profiles
  WHERE id = app.current_user_id() AND app_role = 'technician'
$$;

-- ------------------------------------------------------------------ ledger protection
CREATE OR REPLACE FUNCTION app.forbid_ledger_change() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: correct it with a compensating row', TG_TABLE_NAME;
END $$;

CREATE TRIGGER escrow_append_only BEFORE UPDATE OR DELETE ON "escrow_transactions"
  FOR EACH ROW EXECUTE FUNCTION app.forbid_ledger_change();
CREATE TRIGGER activity_append_only BEFORE UPDATE OR DELETE ON "activity_log"
  FOR EACH ROW EXECUTE FUNCTION app.forbid_ledger_change();
CREATE TRIGGER payout_attempts_append_only BEFORE UPDATE OR DELETE ON "payout_attempts"
  FOR EACH ROW EXECUTE FUNCTION app.forbid_ledger_change();

-- Payouts: never deleted; only status, attempts, failure_reason, paid_at, trigger and due_on change.
CREATE OR REPLACE FUNCTION app.guard_payout_update() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payouts are never deleted: correct them with a compensating payout';
  END IF;
  IF NEW.amount <> OLD.amount OR NEW.type <> OLD.type OR NEW.seller_id <> OLD.seller_id
     OR NEW.device_id IS DISTINCT FROM OLD.device_id
     OR NEW.submission_id IS DISTINCT FROM OLD.submission_id THEN
    RAISE EXCEPTION 'payout amount, type and owner are immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER payouts_guard BEFORE UPDATE OR DELETE ON "payouts"
  FOR EACH ROW EXECUTE FUNCTION app.guard_payout_update();

-- ------------------------------------------------------------------ row-level security
-- Enabled on every table. The app's server code connects as the table owner and is authorised
-- in application policies; these policies are the last line of defence for any other access.
-- No write policies: writes are system-only (docs/roles.md.txt §6).
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables
           WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Public-to-signed-in reference data (catalogue, prices and rules are not secret).
CREATE POLICY settings_read ON "settings" FOR SELECT USING (app.current_user_id() IS NOT NULL);
CREATE POLICY device_models_read ON "device_models" FOR SELECT USING (app.current_user_id() IS NOT NULL);
CREATE POLICY liquidity_read ON "liquidity_scores" FOR SELECT USING (app.current_user_id() IS NOT NULL);
CREATE POLICY hubs_read ON "hubs" FOR SELECT USING (app.current_user_id() IS NOT NULL);
CREATE POLICY listings_read ON "listings" FOR SELECT
  USING (status IN ('active', 'reserved', 'sold') OR app.is_ops());

-- Own rows, or staff.
CREATE POLICY profiles_read ON "profiles" FOR SELECT USING (id = app.current_user_id() OR app.is_ops());
CREATE POLICY submissions_read ON "submissions" FOR SELECT
  USING (seller_id = app.current_user_id() OR app.is_ops());
CREATE POLICY offers_read ON "offers" FOR SELECT USING (seller_id = app.current_user_id() OR app.is_ops());
CREATE POLICY assessments_read ON "grade_assessments" FOR SELECT
  USING (seller_id = app.current_user_id() OR app.is_ops() OR app.current_app_role() = 'technician');
CREATE POLICY payouts_read ON "payouts" FOR SELECT USING (seller_id = app.current_user_id() OR app.is_ops());
CREATE POLICY bookings_read ON "bookings" FOR SELECT
  USING (seller_id = app.current_user_id() OR hub_id = app.current_hub_id() OR app.is_ops());
CREATE POLICY reports_read ON "inspection_reports" FOR SELECT
  USING (hub_id = app.current_hub_id() OR app.is_ops());
CREATE POLICY devices_read ON "devices" FOR SELECT
  USING (seller_id = app.current_user_id() OR hub_id = app.current_hub_id() OR app.is_ops());
CREATE POLICY orders_read ON "orders" FOR SELECT USING (buyer_id = app.current_user_id() OR app.is_ops());
CREATE POLICY escrow_read ON "escrow_transactions" FOR SELECT
  USING (buyer_id = app.current_user_id() OR app.is_ops());
CREATE POLICY returns_read ON "return_requests" FOR SELECT
  USING (buyer_id = app.current_user_id() OR app.is_ops());
CREATE POLICY notifications_read ON "notifications" FOR SELECT USING (user_id = app.current_user_id());
CREATE POLICY support_read ON "support_requests" FOR SELECT
  USING (customer_id = app.current_user_id() OR app.is_ops());

-- Ops-only operational tables.
CREATE POLICY exceptions_read ON "exception_cases" FOR SELECT USING (app.is_ops());
CREATE POLICY activity_read ON "activity_log" FOR SELECT USING (app.is_ops());
CREATE POLICY blacklist_read ON "blacklisted_imeis" FOR SELECT USING (app.is_ops());
-- Remaining infrastructure tables (outbox, job_runs, invitations, …) have RLS on and no
-- policies: denied to everyone except the owning server role.
