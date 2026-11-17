-- Phase 8: Ops → Demo → Reset demo data may delete ledger rows of seeded demo/test accounts.
-- Only a transaction that sets the local flag app.demo_reset = 'on' (the reset command, which
-- scopes rows to demo accounts) passes; every other update or delete is still refused.
CREATE OR REPLACE FUNCTION app.forbid_ledger_change() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.demo_reset', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only: correct it with a compensating row', TG_TABLE_NAME;
END $$;

CREATE OR REPLACE FUNCTION app.guard_payout_update() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.demo_reset', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'payouts are never deleted: correct them with a compensating payout';
  END IF;
  IF NEW.amount <> OLD.amount OR NEW.type <> OLD.type OR NEW.seller_id <> OLD.seller_id
     OR NEW.device_id IS DISTINCT FROM OLD.device_id
     OR NEW.submission_id IS DISTINCT FROM OLD.submission_id THEN
    RAISE EXCEPTION 'payout amount, type and owner are immutable';
  END IF;
  RETURN NEW;
END $$;
