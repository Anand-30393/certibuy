-- Phase 8: reserved days are added when a reservation ends, from the business date it started.
ALTER TABLE "listings" ADD COLUMN "reserved_since" DATE;

-- Backfill live reservations from their paid order (IST date plus the current demo offset).
UPDATE "listings" l
SET "reserved_since" = ((o."paid_at" AT TIME ZONE 'Asia/Kolkata')::date + s."sim_day_offset")
FROM "orders" o, "settings" s
WHERE l."status" = 'reserved'
  AND s."id" = 1
  AND o."listing_id" = l."id"
  AND o."status" IN ('pending', 'paid', 'dispatched', 'in_transit')
  AND o."paid_at" IS NOT NULL;
