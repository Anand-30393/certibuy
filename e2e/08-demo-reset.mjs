// O-11 demo reset: guards, scope (demo/test accounts only), real customers' data untouched, ledger
// protection still active outside the reset. Runs last: it removes the data earlier suites made.
import crypto from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import pg from "pg";

const { Client } = pg;
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const env = process.env;
const results = [];
const check = (label, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
};
function totp(secretB32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secretB32.replace(/=+$/, "").toUpperCase())
    bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = crypto.createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
}
async function session(email, mfa = false) {
  const jar = new Map();
  const client = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (l) =>
          l.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
      },
    },
  );
  const { error } = await client.auth.signInWithPassword({
    email,
    password: env.SEED_DEMO_PASSWORD,
  });
  if (error) throw new Error("sign-in failed: " + email);
  let factorId = null;
  if (mfa) {
    const { data } = await client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `reset ${Date.now()}`,
    });
    await client.auth.mfa.challengeAndVerify({ factorId: data.id, code: totp(data.totp.secret) });
    factorId = data.id;
  }
  return { client, factorId, ck: () => [...jar].map(([n, v]) => `${n}=${v}`).join("; ") };
}
const cmd = async (s, name, body = {}) => {
  const r = await fetch(`${BASE}/api/v1/commands/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: s.ck(), origin: BASE },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const view = async (s, name, q = {}) => {
  const r = await fetch(`${BASE}/api/v1/views/${name}?${new URLSearchParams(q)}`, {
    headers: { cookie: s.ck() },
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

const db = new Client({ connectionString: env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const q1 = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const DEMO = "%@certibuy.test";
const NOT_DEMO = "coalesce(p.email, '') not ilike $1";
const realSnapshot = () =>
  q1(
    `select
      (select count(*)::int from profiles) profiles,
      (select count(*)::int from device_models) models,
      (select count(*)::int from hubs) hubs,
      (select count(*)::int from submissions s join profiles p on p.id = s.seller_id where ${NOT_DEMO}) real_deals,
      (select count(*)::int from orders o join profiles p on p.id = o.buyer_id where ${NOT_DEMO}) real_orders,
      (select count(*)::int from payouts x join profiles p on p.id = x.seller_id where ${NOT_DEMO}) real_payouts,
      (select count(*)::int from notifications n join profiles p on p.id = n.user_id where ${NOT_DEMO}) real_notifications,
      (select commission_pct from settings where id = 1) commission`,
    [DEMO],
  );
const demoCounts = () =>
  q1(
    `select
      (select count(*)::int from submissions s join profiles p on p.id = s.seller_id where p.email ilike $1) deals,
      (select count(*)::int from orders o join profiles p on p.id = o.buyer_id where p.email ilike $1) orders,
      (select count(*)::int from notifications n join profiles p on p.id = n.user_id where p.email ilike $1 and p.app_role = 'customer') notes`,
    [DEMO],
  );
const CONFIRM = { confirm: "RESET DEMO DATA" };

const cu = await session("demo.customer@certibuy.test");
const te = await session("demo.technician@certibuy.test", true);
const op = await session("demo.ops@certibuy.test", true);
try {
  const before = await realSnapshot();
  const demoBefore = await demoCounts();
  check(
    "there is demo data to remove",
    demoBefore.deals > 0,
    `${demoBefore.deals} deals, ${demoBefore.orders} orders`,
  );

  check("customer can't reset (403)", (await cmd(cu, "resetDemoData", CONFIRM)).status === 403);
  check("technician can't reset (403)", (await cmd(te, "resetDemoData", CONFIRM)).status === 403);
  check(
    "wrong confirmation phrase refused (400)",
    (await cmd(op, "resetDemoData", { confirm: "reset" })).status === 400,
  );

  const r = await cmd(op, "resetDemoData", CONFIRM);
  check("reset runs for the platform admin", r.status === 200, JSON.stringify(r.body));
  const demoAfter = await demoCounts();
  check(
    "demo deals and orders removed (except any kept for real customers)",
    demoAfter.deals === r.body.kept?.deals && demoAfter.orders <= r.body.kept?.orders,
    JSON.stringify(demoAfter),
  );
  check(
    "demo customers' notifications cleared (ops may get fresh liquidity notices)",
    demoAfter.notes === 0,
  );
  const after = await realSnapshot();
  check(
    "real customers' data, accounts, catalogue, hubs and settings untouched",
    JSON.stringify(after) === JSON.stringify(before),
    JSON.stringify(after),
  );
  check(
    "demo clock back to today",
    (await q1("select sim_day_offset from settings where id = 1")).sim_day_offset === 0,
  );
  const orphans = await q1(`select
    (select count(*)::int from listings l left join devices d on d.id = l.device_id where d.id is null)
    + (select count(*)::int from escrow_transactions e left join orders o on o.id = e.order_id where o.id is null)
    + (select count(*)::int from payout_attempts a left join payouts p on p.id = a.payout_id where p.id is null) n`);
  check("no listings, escrow rows or payout attempts left without their parent", orphans.n === 0);

  const liq = await q1(
    "select count(*)::int n, count(*) filter (where calculated_at >= now() - interval '5 minutes')::int fresh from liquidity_scores where is_current",
  );
  check(
    "liquidity recalculated from the remaining data",
    liq.n > 0 && liq.fresh === liq.n,
    JSON.stringify(liq),
  );

  let blocked = false;
  try {
    await db.query("delete from activity_log where id = (select id from activity_log limit 1)");
  } catch {
    blocked = true;
  }
  check("ledger rows still can't be deleted outside the reset", blocked);
  check(
    "reset recorded in the audit log",
    (await view(op, "getAuditLog", { q: "Demo data reset" })).body.entries?.length >= 1,
  );
  check(
    "app works after the reset (sell catalogue, shop, ops overview)",
    (await view(cu, "getSellCatalogue")).status === 200 &&
      (await view(cu, "getShopCatalogue", { sort: "price_asc" })).status === 200 &&
      (await view(op, "getOpsOverview")).status === 200,
  );
  check(
    "a second reset is safe and removes nothing more",
    (await cmd(op, "resetDemoData", CONFIRM)).body.removed?.deals === 0,
  );
} finally {
  for (const s of [te, op])
    if (s.factorId) await s.client.auth.mfa.unenroll({ factorId: s.factorId });
  check(
    "temporary MFA factors removed",
    (await q1("select count(*)::int n from auth.mfa_factors")).n === 0,
  );
  await db.end();
}
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
process.exitCode = results.every(Boolean) ? 0 : 1;
