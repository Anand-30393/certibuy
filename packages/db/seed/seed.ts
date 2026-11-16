// Phase 2 seed: Settings (from the golden defaults), hubs, a starter catalogue and one demo
// account per role. Idempotent: existing rows are left as they are (upsert with no updates).
// Run: corepack pnpm --filter @certibuy/db seed   (reads ../../.env.local)
import { readFileSync } from "node:fs";
import { createPrismaClient } from "../src/index";

try {
  process.loadEnvFile(new URL("../../../.env.local", import.meta.url));
} catch {
  // Variables may come from the environment instead.
}

const prisma = createPrismaClient(process.env.DIRECT_URL ?? process.env.DATABASE_URL);

const settings = JSON.parse(
  readFileSync(new URL("../../domain/__fixtures__/settings.default.json", import.meta.url), "utf8"),
).settings;

const HUBS = [
  {
    id: "hub_bengaluru_indiranagar",
    name: "CertiBuy Indiranagar",
    type: "flagship" as const,
    address: "100 Feet Road, Indiranagar",
    city: "Bengaluru",
    pincode: "560038",
    slot_times: ["10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00"],
    daily_capacity: 24,
    distance_km: 3.2,
  },
  {
    id: "hub_mumbai_andheri",
    name: "CertiBuy Andheri",
    type: "flagship" as const,
    address: "Link Road, Andheri West",
    city: "Mumbai",
    pincode: "400053",
    slot_times: ["10:00", "11:30", "13:00", "15:00", "16:30"],
    daily_capacity: 20,
    distance_km: 5.8,
  },
  {
    id: "hub_chennai_tnagar_partner",
    name: "QuickFix Partner Hub, T. Nagar",
    type: "partner" as const,
    address: "Usman Road, T. Nagar",
    city: "Chennai",
    pincode: "600017",
    slot_times: ["11:00", "13:00", "15:00", "17:00"],
    daily_capacity: 12,
    distance_km: 7.5,
  },
];

// Starter catalogue. Prices are placeholders until ops loads checked market prices (O-03).
const MODELS = [
  ["Apple", "iPhone 14", "128 GB", "phone", 52000, 47000, null, null, 26000, "high"],
  ["Apple", "iPhone 13", "128 GB", "phone", 41000, null, null, null, 21000, "high"],
  ["Samsung", "Galaxy S23", "256 GB", "phone", 48000, null, null, null, 23000, "medium"],
  ["OnePlus", "11", "256 GB", "phone", 32000, null, null, null, 15000, "medium"],
  ["Apple", "MacBook Air M2", "256 GB", "laptop", 78000, null, null, null, 42000, "medium"],
  ["Apple", "iPad Air (5th gen)", "64 GB", "tablet", 38000, null, null, null, 19000, "low"],
] as const;

const DEMO_USERS = [
  { email: "demo.customer@certibuy.test", full_name: "Demo Customer", app_role: "customer" },
  {
    email: "demo.technician@certibuy.test",
    full_name: "Demo Technician",
    app_role: "technician",
    hub_id: "hub_bengaluru_indiranagar",
  },
  {
    email: "demo.ops@certibuy.test",
    full_name: "Demo Operations",
    app_role: "ops",
    is_platform_admin: true,
  },
] as const;

/** Create (or find) a confirmed auth user through the Supabase Auth admin API. */
async function ensureAuthUser(email: string, fullName: string, password: string): Promise<string> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("Supabase URL or service role key is not set.");
  const headers = {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  };

  const existing = await prisma.profile.findFirst({ where: { email }, select: { id: true } });
  if (existing) return existing.id;

  const res = await fetch(`${base}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    }),
  });
  if (!res.ok) throw new Error(`Could not create ${email}: HTTP ${res.status}`);
  const user = (await res.json()) as { id: string };
  return user.id;
}

async function main(): Promise<void> {
  await prisma.settings.upsert({ where: { id: 1 }, create: { id: 1, ...settings }, update: {} });
  console.log("settings: ok");

  for (const hub of HUBS) {
    await prisma.hub.upsert({ where: { id: hub.id }, create: hub, update: {} });
  }
  console.log(`hubs: ${HUBS.length}`);

  for (const [brand, model, storage, category, a, b, c, d, floor, tier] of MODELS) {
    await prisma.deviceModel.upsert({
      where: { brand_model_storage: { brand, model, storage } },
      create: {
        brand,
        model,
        storage,
        category,
        colours: ["Black", "White"],
        market_price_a: a,
        market_price_b: b,
        market_price_c: c,
        market_price_d: d,
        b2b_floor_price: floor,
        liquidity_tier: tier,
        price_is_placeholder: true,
      },
      update: {},
    });
  }
  console.log(`device models: ${MODELS.length}`);

  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password) {
    console.log("demo users: skipped (SEED_DEMO_PASSWORD is not set)");
    return;
  }
  for (const u of DEMO_USERS) {
    const id = await ensureAuthUser(u.email, u.full_name, password);
    // The auth trigger created the profile as a customer; apply the demo role once.
    await prisma.profile.update({
      where: { id },
      data: {
        app_role: u.app_role,
        hub_id: "hub_id" in u ? u.hub_id : null,
        is_platform_admin: "is_platform_admin" in u ? u.is_platform_admin : false,
      },
    });
  }
  console.log(`demo users: ${DEMO_USERS.length}`);
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
