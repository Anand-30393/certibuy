-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AppRole" AS ENUM ('customer', 'technician', 'ops');

-- CreateEnum
CREATE TYPE "ActiveMode" AS ENUM ('buyer', 'seller');

-- CreateEnum
CREATE TYPE "DeviceCategory" AS ENUM ('phone', 'laptop', 'tablet', 'watch');

-- CreateEnum
CREATE TYPE "LiquidityTier" AS ENUM ('high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "HubType" AS ENUM ('flagship', 'partner');

-- CreateEnum
CREATE TYPE "Grade" AS ENUM ('A', 'B', 'C', 'D');

-- CreateEnum
CREATE TYPE "Repaired" AS ENUM ('no', 'authorised', 'other_shop', 'not_sure');

-- CreateEnum
CREATE TYPE "BillBox" AS ENUM ('bill_and_box', 'bill_only', 'box_only', 'neither');

-- CreateEnum
CREATE TYPE "WarrantyStatus" AS ENUM ('in_warranty', 'expired', 'unknown');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('draft', 'graded', 'offer_accepted', 'scheduled', 'inspected', 'accepted', 'rejected', 'abandoned');

-- CreateEnum
CREATE TYPE "PayoutOption" AS ENUM ('instant_cash', 'sell_for_more');

-- CreateEnum
CREATE TYPE "MismatchFeeStatus" AS ENUM ('none', 'pending', 'paid', 'waived');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('active', 'accepted', 'declined', 'expired');

-- CreateEnum
CREATE TYPE "RiskTier" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "AssessmentSource" AS ENUM ('ai', 'technician');

-- CreateEnum
CREATE TYPE "ConfidenceLevel" AS ENUM ('High', 'Medium', 'Low');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('booked', 'completed', 'cancelled', 'no_show');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('intake', 'return');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('inside', 'one_below', 'two_below');

-- CreateEnum
CREATE TYPE "SellerDecision" AS ENUM ('pending', 'accepted', 'declined', 'fee_paid', 'fee_due');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('in_refurbishment', 'listed', 'day45_review', 'reserved', 'shipped', 'delivered', 'settled', 'returned', 'liquidated');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('active', 'reserved', 'sold', 'review', 'liquidated', 'inactive');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending', 'paid', 'dispatched', 'in_transit', 'delivered', 'settled', 'refunded', 'replaced', 'cancelled');

-- CreateEnum
CREATE TYPE "EscrowStatus" AS ENUM ('hold', 'released', 'refunded_full', 'refunded_partial', 'held_replacement');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('upi', 'card', 'netbanking');

-- CreateEnum
CREATE TYPE "EscrowTxType" AS ENUM ('hold', 'release', 'refund_full', 'refund_partial');

-- CreateEnum
CREATE TYPE "ReturnReason" AS ENUM ('not_as_graded', 'dead_on_arrival', 'buyer_changed_mind');

-- CreateEnum
CREATE TYPE "DoaPreference" AS ENUM ('refund', 'replacement');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('awaiting_reinspection', 'awaiting_decision', 'resolved');

-- CreateEnum
CREATE TYPE "ReturnRecommendation" AS ENUM ('faulty', 'as_shipped', 'doa_confirmed');

-- CreateEnum
CREATE TYPE "ReturnOutcome" AS ENUM ('faulty', 'as_shipped', 'doa_confirmed', 'doa_replacement', 'changed_mind');

-- CreateEnum
CREATE TYPE "DeductionLabel" AS ENUM ('shipping_charges', 'return_logistics');

-- CreateEnum
CREATE TYPE "PayoutType" AS ENUM ('instant_cash_full', 'advance', 'balance', 'mismatch_fee');

-- CreateEnum
CREATE TYPE "PayoutTrigger" AS ENUM ('custody_handover', 'buyer_paid_escrow', 'day_21_unsold', 'inspection_mismatch');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('pending', 'approved', 'paid', 'failed', 'due');

-- CreateEnum
CREATE TYPE "ExceptionType" AS ENUM ('return', 'failed_inspection', 'grade_dispute', 'payment_hold');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('open', 'resolved');

-- CreateEnum
CREATE TYPE "SupportTopic" AS ENUM ('selling_device', 'order_delivery', 'return_refund', 'payments', 'other');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('pending', 'accepted', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('pending', 'sent', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('running', 'done', 'failed');

-- CreateEnum
CREATE TYPE "PaymentIntentStatus" AS ENUM ('pending', 'authorised', 'captured', 'declined', 'cancelled');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('submission_photo', 'inspection_photo', 'return_photo', 'signature', 'avatar', 'catalogue');

-- CreateTable
CREATE TABLE "profiles" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "full_name" TEXT,
    "app_role" "AppRole" NOT NULL DEFAULT 'customer',
    "active_mode" "ActiveMode",
    "phone" TEXT,
    "city" TEXT,
    "avatar_key" TEXT,
    "payout_account" TEXT,
    "delivery_address" TEXT,
    "hub_id" TEXT,
    "trust_score" INTEGER NOT NULL DEFAULT 100,
    "return_count" INTEGER NOT NULL DEFAULT 0,
    "account_flagged" BOOLEAN NOT NULL DEFAULT false,
    "is_platform_admin" BOOLEAN NOT NULL DEFAULT false,
    "created_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "commission_pct" DOUBLE PRECISION NOT NULL,
    "inspection_fee" INTEGER NOT NULL,
    "mismatch_fee" INTEGER NOT NULL,
    "return_logistics_charge" INTEGER NOT NULL,
    "change_mind_fee" INTEGER NOT NULL,
    "warranty_months" INTEGER NOT NULL,
    "warranty_addon_pct" DOUBLE PRECISION NOT NULL,
    "advance_pct" DOUBLE PRECISION NOT NULL,
    "balance_day" INTEGER NOT NULL,
    "payout_max_attempts" INTEGER NOT NULL,
    "step1_day" INTEGER NOT NULL,
    "step1_pct" DOUBLE PRECISION NOT NULL,
    "step2_day" INTEGER NOT NULL,
    "step2_pct" DOUBLE PRECISION NOT NULL,
    "review_day" INTEGER NOT NULL,
    "alert_window_days" INTEGER NOT NULL,
    "return_window_days" INTEGER NOT NULL,
    "liquidity_threshold" DOUBLE PRECISION NOT NULL,
    "near_band" DOUBLE PRECISION NOT NULL,
    "risk_small_pct" DOUBLE PRECISION NOT NULL,
    "risk_large_pct" DOUBLE PRECISION NOT NULL,
    "launch_window_days" INTEGER NOT NULL,
    "launch_tighten_pts" DOUBLE PRECISION NOT NULL,
    "liq_w_days" DOUBLE PRECISION NOT NULL,
    "liq_w_demand" DOUBLE PRECISION NOT NULL,
    "liq_w_volatility" DOUBLE PRECISION NOT NULL,
    "liq_w_launch" DOUBLE PRECISION NOT NULL,
    "liq_review_penalty" DOUBLE PRECISION NOT NULL,
    "inventory_cap" INTEGER NOT NULL,
    "per_model_cap" INTEGER NOT NULL,
    "price_band_min" INTEGER NOT NULL,
    "price_band_max" INTEGER NOT NULL,
    "grade_factor_b" DOUBLE PRECISION NOT NULL,
    "grade_factor_c" DOUBLE PRECISION NOT NULL,
    "grade_factor_d" DOUBLE PRECISION NOT NULL,
    "battery_a_min" INTEGER NOT NULL,
    "battery_b_min" INTEGER NOT NULL,
    "battery_c_min" INTEGER NOT NULL,
    "photo_retake_medium" INTEGER NOT NULL,
    "photo_min_px" INTEGER NOT NULL,
    "photo_min_brightness" INTEGER NOT NULL,
    "offer_expiry_days" INTEGER NOT NULL,
    "checkout_hold_minutes" INTEGER NOT NULL,
    "cancel_fee" INTEGER NOT NULL,
    "hub_cost" INTEGER NOT NULL,
    "demo_mode" BOOLEAN NOT NULL,
    "sim_day_offset" INTEGER NOT NULL,
    "simulate_payout_failure" BOOLEAN NOT NULL,
    "settings_version" INTEGER NOT NULL DEFAULT 1,
    "updated_date" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_models" (
    "id" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "storage" TEXT NOT NULL,
    "category" "DeviceCategory" NOT NULL,
    "colours" TEXT[],
    "image_url" TEXT,
    "launch_date" DATE,
    "successor_launch_date" DATE,
    "original_price" INTEGER,
    "market_price_a" INTEGER NOT NULL,
    "market_price_b" INTEGER,
    "market_price_c" INTEGER,
    "market_price_d" INTEGER,
    "b2b_floor_price" INTEGER NOT NULL,
    "price_is_placeholder" BOOLEAN NOT NULL DEFAULT false,
    "liquidity_tier" "LiquidityTier" NOT NULL DEFAULT 'medium',
    "ic_paused" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "device_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidity_scores" (
    "id" TEXT NOT NULL,
    "device_model_id" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "days_to_sell" DOUBLE PRECISION,
    "volatility" DOUBLE PRECISION,
    "launch_window" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL,
    "calculated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_current" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "liquidity_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hubs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "HubType" NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "slot_times" TEXT[],
    "daily_capacity" INTEGER NOT NULL,
    "distance_km" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "hubs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blacklisted_imeis" (
    "id" TEXT NOT NULL,
    "imei" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blacklisted_imeis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "device_model_id" TEXT NOT NULL,
    "colour" TEXT,
    "imei" TEXT,
    "age_months" INTEGER,
    "declared_cosmetic" "Grade",
    "repaired" "Repaired",
    "water_exposure" BOOLEAN,
    "bill_box" "BillBox",
    "warranty_status" "WarrantyStatus",
    "photos" JSONB NOT NULL DEFAULT '[]',
    "retake_count" INTEGER NOT NULL DEFAULT 0,
    "diagnostics" JSONB NOT NULL DEFAULT '{}',
    "status" "SubmissionStatus" NOT NULL DEFAULT 'draft',
    "reject_reason" TEXT,
    "chosen_option" "PayoutOption",
    "consent_at" TIMESTAMPTZ(6),
    "current_offer_id" TEXT,
    "final_grade" "Grade",
    "mismatch_fee_status" "MismatchFeeStatus" NOT NULL DEFAULT 'none',
    "created_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "submission_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "priced_band" "Grade"[],
    "instant_cash_amount" INTEGER,
    "guaranteed_price" INTEGER NOT NULL,
    "ic_eligible" BOOLEAN NOT NULL,
    "ic_reason" TEXT,
    "risk_pct" DOUBLE PRECISION NOT NULL,
    "risk_tier" "RiskTier" NOT NULL,
    "breakdown" JSONB NOT NULL,
    "settings_version" INTEGER NOT NULL,
    "expires_at" DATE NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'active',
    "created_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_assessments" (
    "id" TEXT NOT NULL,
    "submission_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "source" "AssessmentSource" NOT NULL,
    "band" "Grade"[],
    "estimate" "Grade" NOT NULL,
    "confidence" INTEGER NOT NULL,
    "confidence_level" "ConfidenceLevel" NOT NULL,
    "factors" JSONB NOT NULL,
    "final_grade" "Grade",
    "set_by" TEXT,
    "component_grades" JSONB,
    "variance" INTEGER,
    "created_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grade_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "submission_id" TEXT NOT NULL,
    "hub_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "slot" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'booked',
    "created_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_reports" (
    "id" TEXT NOT NULL,
    "type" "ReportType" NOT NULL,
    "submission_id" TEXT,
    "return_request_id" TEXT,
    "hub_id" TEXT NOT NULL,
    "technician_id" TEXT,
    "checklist" JSONB NOT NULL DEFAULT '{}',
    "battery_health" INTEGER,
    "cosmetic_grade" "Grade",
    "photos" JSONB NOT NULL DEFAULT '[]',
    "computed_grade" "Grade",
    "component_grades" JSONB,
    "ai_band" "Grade"[],
    "verdict" "Verdict",
    "quoted_amount" INTEGER,
    "revised_amount" INTEGER,
    "seller_decision" "SellerDecision",
    "sealed" BOOLEAN NOT NULL DEFAULT false,
    "sealed_at" TIMESTAMPTZ(6),
    "tag_id" TEXT,
    "signature_key" TEXT,
    "scanned_imei" TEXT,
    "blacklist_clear" BOOLEAN,
    "activation_lock_off" BOOLEAN,
    "identity_passed" BOOLEAN,
    "return_recommendation" TEXT,
    "notes" TEXT,
    "created_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inspection_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "submission_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "device_model_id" TEXT NOT NULL,
    "colour" TEXT,
    "imei" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "final_grade" "Grade" NOT NULL,
    "payout_option" "PayoutOption" NOT NULL,
    "acquisition_cost" INTEGER NOT NULL,
    "owner" TEXT NOT NULL DEFAULT 'certibuy',
    "custody_at" DATE NOT NULL,
    "hub_id" TEXT NOT NULL,
    "balance_paid" BOOLEAN NOT NULL DEFAULT false,
    "parts_replaced" TEXT[],
    "return_count" INTEGER NOT NULL DEFAULT 0,
    "status" "DeviceStatus" NOT NULL,
    "created_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listings" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "base_price" INTEGER NOT NULL,
    "current_price" INTEGER NOT NULL,
    "floor_price" INTEGER NOT NULL,
    "ladder_step" INTEGER NOT NULL DEFAULT 0,
    "listed_at" DATE NOT NULL,
    "reserved_days" INTEGER NOT NULL DEFAULT 0,
    "override_price" INTEGER,
    "override_by" TEXT,
    "override_at" TIMESTAMPTZ(6),
    "warranty_months" INTEGER NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'active',
    "created_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "device_price" INTEGER NOT NULL,
    "warranty_addon" BOOLEAN NOT NULL DEFAULT false,
    "warranty_addon_amount" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "delivery_name" TEXT NOT NULL,
    "delivery_phone" TEXT NOT NULL,
    "delivery_address" TEXT NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "escrow_status" "EscrowStatus",
    "paid_at" TIMESTAMPTZ(6),
    "dispatched_at" TIMESTAMPTZ(6),
    "in_transit_at" TIMESTAMPTZ(6),
    "delivered_at" DATE,
    "return_window_closes_at" DATE,
    "settled_at" TIMESTAMPTZ(6),
    "refund_amount" INTEGER,
    "refunded_at" TIMESTAMPTZ(6),
    "replacement_device_id" TEXT,
    "hold_expires_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "created_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escrow_transactions" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "type" "EscrowTxType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT,
    "return_request_id" TEXT,
    "created_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escrow_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_requests" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "hub_id" TEXT,
    "reason" "ReturnReason" NOT NULL,
    "buyer_reason_note" TEXT,
    "note" TEXT,
    "photos" JSONB NOT NULL DEFAULT '[]',
    "doa_preference" "DoaPreference",
    "status" "ReturnStatus" NOT NULL DEFAULT 'awaiting_reinspection',
    "recommendation" "ReturnRecommendation",
    "report_id" TEXT,
    "outcome" "ReturnOutcome",
    "original_amount" INTEGER NOT NULL,
    "deduction_amount" INTEGER,
    "deduction_label" "DeductionLabel",
    "refund_amount" INTEGER,
    "replacement_device_id" TEXT,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMPTZ(6),
    "created_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "return_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "submission_id" TEXT,
    "device_id" TEXT,
    "type" "PayoutType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "trigger" "PayoutTrigger",
    "status" "PayoutStatus" NOT NULL,
    "due_on" DATE,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failure_reason" TEXT,
    "paid_at" TIMESTAMPTZ(6),
    "created_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exception_cases" (
    "id" TEXT NOT NULL,
    "type" "ExceptionType" NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "related_entity" TEXT,
    "related_id" TEXT,
    "status" "CaseStatus" NOT NULL DEFAULT 'open',
    "resolution" TEXT,
    "created_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "exception_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_log" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_name" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "entity" TEXT,
    "entity_id" TEXT,
    "business_date" DATE NOT NULL,
    "created_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT NOT NULL DEFAULT '',
    "read" BOOLEAN NOT NULL DEFAULT false,
    "dedupe_key" TEXT,
    "created_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_requests" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "topic" "SupportTopic" NOT NULL,
    "related_id" TEXT,
    "message" TEXT NOT NULL,
    "status" "CaseStatus" NOT NULL DEFAULT 'open',
    "reply" TEXT,
    "replied_by" TEXT,
    "replied_at" TIMESTAMPTZ(6),
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMPTZ(6),
    "created_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "support_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_attempts" (
    "id" TEXT NOT NULL,
    "payout_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "PayoutStatus" NOT NULL,
    "reference" TEXT,
    "failure_reason" TEXT,
    "created_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'simulated',
    "reference" TEXT,
    "amount" INTEGER NOT NULL,
    "status" "PaymentIntentStatus" NOT NULL,
    "created_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "awb" TEXT,
    "actor_id" TEXT,
    "created_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "to_email" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'pending',
    "failure_reason" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "created_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_objects" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT,
    "kind" "FileKind" NOT NULL,
    "bucket" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "size_bytes" INTEGER,
    "content_type" TEXT,
    "related_id" TEXT,
    "created_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings_history" (
    "id" TEXT NOT NULL,
    "settings_version" INTEGER NOT NULL,
    "changed_by" TEXT,
    "changes" JSONB NOT NULL,
    "created_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'running',
    "cursor" TEXT,
    "counts" JSONB NOT NULL DEFAULT '{}',
    "actor_id" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "app_role" "AppRole" NOT NULL,
    "hub_id" TEXT,
    "invited_by" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_by" TEXT,
    "accepted_at" TIMESTAMPTZ(6),
    "created_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "created_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ(6) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "profiles_app_role_idx" ON "profiles"("app_role");

-- CreateIndex
CREATE INDEX "device_models_active_category_idx" ON "device_models"("active", "category");

-- CreateIndex
CREATE UNIQUE INDEX "device_models_brand_model_storage_key" ON "device_models"("brand", "model", "storage");

-- CreateIndex
CREATE INDEX "liquidity_scores_device_model_id_is_current_idx" ON "liquidity_scores"("device_model_id", "is_current");

-- CreateIndex
CREATE UNIQUE INDEX "blacklisted_imeis_imei_key" ON "blacklisted_imeis"("imei");

-- CreateIndex
CREATE INDEX "submissions_seller_id_status_created_date_idx" ON "submissions"("seller_id", "status", "created_date" DESC);

-- CreateIndex
CREATE INDEX "offers_submission_id_status_created_date_idx" ON "offers"("submission_id", "status", "created_date" DESC);

-- CreateIndex
CREATE INDEX "offers_status_expires_at_idx" ON "offers"("status", "expires_at");

-- CreateIndex
CREATE INDEX "grade_assessments_submission_id_idx" ON "grade_assessments"("submission_id");

-- CreateIndex
CREATE INDEX "bookings_hub_id_date_status_idx" ON "bookings"("hub_id", "date", "status");

-- CreateIndex
CREATE INDEX "bookings_submission_id_status_idx" ON "bookings"("submission_id", "status");

-- CreateIndex
CREATE INDEX "inspection_reports_submission_id_type_idx" ON "inspection_reports"("submission_id", "type");

-- CreateIndex
CREATE INDEX "inspection_reports_hub_id_idx" ON "inspection_reports"("hub_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_submission_id_key" ON "devices"("submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_tag_id_key" ON "devices"("tag_id");

-- CreateIndex
CREATE INDEX "devices_owner_status_idx" ON "devices"("owner", "status");

-- CreateIndex
CREATE INDEX "devices_device_model_id_idx" ON "devices"("device_model_id");

-- CreateIndex
CREATE INDEX "listings_status_current_price_idx" ON "listings"("status", "current_price");

-- CreateIndex
CREATE INDEX "listings_device_id_idx" ON "listings"("device_id");

-- CreateIndex
CREATE INDEX "orders_buyer_id_created_date_idx" ON "orders"("buyer_id", "created_date" DESC);

-- CreateIndex
CREATE INDEX "orders_listing_id_idx" ON "orders"("listing_id");

-- CreateIndex
CREATE INDEX "orders_status_delivered_at_idx" ON "orders"("status", "delivered_at");

-- CreateIndex
CREATE INDEX "orders_status_hold_expires_at_idx" ON "orders"("status", "hold_expires_at");

-- CreateIndex
CREATE INDEX "escrow_transactions_order_id_idx" ON "escrow_transactions"("order_id");

-- CreateIndex
CREATE INDEX "return_requests_buyer_id_status_idx" ON "return_requests"("buyer_id", "status");

-- CreateIndex
CREATE INDEX "return_requests_status_created_date_idx" ON "return_requests"("status", "created_date" DESC);

-- CreateIndex
CREATE INDEX "payouts_seller_id_created_date_idx" ON "payouts"("seller_id", "created_date" DESC);

-- CreateIndex
CREATE INDEX "payouts_status_idx" ON "payouts"("status");

-- CreateIndex
CREATE INDEX "payouts_device_id_idx" ON "payouts"("device_id");

-- CreateIndex
CREATE INDEX "exception_cases_status_type_idx" ON "exception_cases"("status", "type");

-- CreateIndex
CREATE INDEX "activity_log_business_date_idx" ON "activity_log"("business_date" DESC);

-- CreateIndex
CREATE INDEX "activity_log_entity_entity_id_idx" ON "activity_log"("entity", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_created_date_idx" ON "notifications"("user_id", "read", "created_date" DESC);

-- CreateIndex
CREATE INDEX "support_requests_status_created_date_idx" ON "support_requests"("status", "created_date" DESC);

-- CreateIndex
CREATE INDEX "support_requests_customer_id_idx" ON "support_requests"("customer_id");

-- CreateIndex
CREATE INDEX "payout_attempts_payout_id_idx" ON "payout_attempts"("payout_id");

-- CreateIndex
CREATE INDEX "payment_intents_order_id_idx" ON "payment_intents"("order_id");

-- CreateIndex
CREATE INDEX "shipments_order_id_idx" ON "shipments"("order_id");

-- CreateIndex
CREATE INDEX "outbox_status_created_date_idx" ON "outbox"("status", "created_date");

-- CreateIndex
CREATE UNIQUE INDEX "file_objects_key_key" ON "file_objects"("key");

-- CreateIndex
CREATE INDEX "file_objects_related_id_kind_idx" ON "file_objects"("related_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "job_runs_job_business_date_key" ON "job_runs"("job", "business_date");

-- CreateIndex
CREATE INDEX "invitations_email_status_idx" ON "invitations"("email", "status");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "hubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidity_scores" ADD CONSTRAINT "liquidity_scores_device_model_id_fkey" FOREIGN KEY ("device_model_id") REFERENCES "device_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_device_model_id_fkey" FOREIGN KEY ("device_model_id") REFERENCES "device_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_assessments" ADD CONSTRAINT "grade_assessments_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "hubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_reports" ADD CONSTRAINT "inspection_reports_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_reports" ADD CONSTRAINT "inspection_reports_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "hubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_device_model_id_fkey" FOREIGN KEY ("device_model_id") REFERENCES "device_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "hubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escrow_transactions" ADD CONSTRAINT "escrow_transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_attempts" ADD CONSTRAINT "payout_attempts_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
