// End-to-end jobs (Phase 6): outbox, daily job steps, reruns, demo clock, payout failure → hold →
// retry, liquidity, notifications. Resets the demo clock to today at the end.
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
      friendlyName: `jobs-e2e ${Date.now()}`,
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
const page = async (s, path) =>
  (await fetch(BASE + path, { headers: { cookie: s.ck() }, redirect: "manual" })).status;
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(2048, 7),
  Buffer.from([0xff, 0xd9]),
]);
const SELLER = [
  "battery",
  "screen_touch",
  "speakers",
  "microphone",
  "cameras",
  "charging",
  "sensors",
  "imei_blacklist",
  "activation_lock",
];

const db = new Client({ connectionString: env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const q1 = async (sql, p = []) => (await db.query(sql, p)).rows[0];

const cu = await session("demo.customer@certibuy.test");
const op = await session("demo.ops@certibuy.test", true);
const advance = async (days) => {
  const r = await cmd(op, "advanceDemoClock", { days });
  if (r.status !== 200) throw new Error("advance failed: " + JSON.stringify(r.body));
  return r.body;
};

try {
  // ---- setup: a delivered order (escrow on hold) and a fresh graded offer ---------------------
  const listing = (await view(cu, "getShopCatalogue", { sort: "price_asc" })).body.items[0];
  const placed = await cmd(cu, "placeOrders", {
    items: [{ listingId: listing.listingId, warrantyAddon: false }],
    deliveryName: "Demo Customer",
    deliveryPhone: "9876543210",
    deliveryAddress: "12 MG Road, Bengaluru 560001",
    paymentMethod: "upi",
  });
  const orderId = placed.body.orders[0].orderId;
  for (let i = 0; i < 3; i++) await cmd(cu, "advanceShipment", { orderId });
  const iphone = (await view(cu, "getSellCatalogue")).body.models.find(
    (m) => m.model === "iPhone 13",
  );
  const subId = (await cmd(cu, "createSubmission", { deviceModelId: iphone.id })).body.submissionId;
  await cmd(cu, "saveSubmissionDetails", {
    submissionId: subId,
    colour: "Black",
    imei: "490154203237518",
    ageMonths: 24,
    declaredCosmetic: "B",
    repaired: "no",
    waterExposure: false,
    billBox: "neither",
    warrantyStatus: "expired",
  });
  for (const p of (await view(cu, "getSubmission", { submissionId: subId })).body.photos) {
    const up = await cmd(cu, "requestPhotoUpload", { submissionId: subId, key: p.key });
    await fetch(up.body.signedUrl, {
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      body: JPEG,
    });
    await cmd(cu, "confirmPhoto", {
      submissionId: subId,
      key: p.key,
      path: up.body.path,
      brightness: 150,
      failedAttempts: 0,
    });
  }
  await cmd(cu, "saveDiagnostics", {
    submissionId: subId,
    checks: Object.fromEntries(SELLER.map((k) => [k, "pass"])),
    batteryHealth: 88,
  });
  await cmd(cu, "gradeSubmission", { submissionId: subId });
  check(
    "setup: delivered order on hold and a graded offer",
    (await q1("select status, escrow_status from orders where id = $1", [orderId]))
      .escrow_status === "hold" &&
      (await q1("select status from submissions where id = $1", [subId])).status === "graded",
  );

  // ---- outbox ------------------------------------------------------------------------------
  const pendingBefore = (await q1("select count(*)::int n from outbox where status = 'pending'")).n;
  const ob = await cmd(op, "processOutbox");
  check(
    "outbox: queued emails delivered by the simulated adapter",
    ob.status === 200 &&
      (await q1("select count(*)::int n from outbox where status = 'pending'")).n === 0,
    `${pendingBefore} pending before, sent ${ob.body.counts?.sent}`,
  );
  check("mail log page renders", (await page(op, "/ops/mail-log")) === 200);

  // ---- daily job today + rerun safety -------------------------------------------------------
  const d1 = await cmd(op, "runDailyJobs");
  const d2 = await cmd(op, "runDailyJobs");
  const moneyKeys = [
    "balances",
    "payoutsPaid",
    "settled",
    "expiredOffers",
    "reminders",
    "stepped",
    "reviewed",
  ];
  check(
    "daily job runs; an immediate rerun does nothing new",
    d1.status === 200 && d2.status === 200 && moneyKeys.every((k) => d2.body.counts[k] === 0),
    JSON.stringify(d1.body.counts),
  );
  check("jobs page renders", (await page(op, "/ops/jobs")) === 200);

  // ---- +5 days: reminders, no-shows ----------------------------------------------------------
  const a5 = await advance(5);
  const reminderCount = async () =>
    (
      await q1(
        "select count(*)::int n from notifications where event in ('offer_expiring','return_window_closing') and (link = $1 or link = $2)",
        [`/shop/orders/${orderId}`, `/seller/sell/${subId}/offer`],
      )
    ).n;
  const r1 = await reminderCount();
  check(
    "+5 days: offer-expiring and return-window reminders sent",
    r1 === 2,
    `${a5.counts.reminders} reminders, no-shows ${a5.counts.noShows}`,
  );
  await cmd(op, "runDailyJobs");
  check("reminders are not repeated on a rerun", (await reminderCount()) === 2);
  check(
    "past bookings become no-shows",
    (await q1("select count(*)::int n from bookings where status = 'no_show'")).n >= 1,
  );

  // ---- +3 days (day 8): escrow release, offer expiry -----------------------------------------
  const a8 = await advance(3);
  const o = await q1(
    "select o.status, o.escrow_status, (select count(*)::int from escrow_transactions where order_id = o.id and type = 'release') releases, (select status from devices where id = o.device_id) device from orders o where o.id = $1",
    [orderId],
  );
  check(
    "day 8: escrow released once, order settled, device settled",
    o.status === "settled" &&
      o.escrow_status === "released" &&
      o.releases === 1 &&
      o.device === "settled",
    JSON.stringify(o),
  );
  const sub = await q1(
    "select s.status, (select status from offers where id = s.current_offer_id) offer from submissions s where s.id = $1",
    [subId],
  );
  check(
    "day 8: expired offer closes the deal",
    sub.status === "abandoned" && sub.offer === "expired",
    `settled ${a8.counts.settled}, expired offers ${a8.counts.expiredOffers}`,
  );
  await cmd(op, "runDailyJobs");
  check(
    "rerun never releases escrow twice",
    (
      await q1(
        "select count(*)::int n from escrow_transactions where order_id = $1 and type = 'release'",
        [orderId],
      )
    ).n === 1,
  );

  // ---- +7 days (day 15): ladder step 1 ------------------------------------------------------
  const a15 = await advance(7);
  const stepped = await q1(
    "select count(*)::int n, min(current_price)::int min_price from listings where status = 'active' and ladder_step = 1 and current_price < base_price",
  );
  check(
    "day 15: listings step down 7% (rounded to ₹10, floor-protected)",
    a15.counts.stepped >= 1 && stepped.n >= 1,
    `${a15.counts.stepped} stepped`,
  );
  const iphone14B = await q1(
    "select current_price, base_price from listings where status = 'active' and ladder_step = 1 and base_price = 47000 limit 1",
  );
  check(
    "₹47,000 grade-B listing now ₹43,710",
    !iphone14B || iphone14B.current_price === 43710,
    JSON.stringify(iphone14B),
  );

  // ---- payout failures, then day 21: balances due → payment hold → retry ---------------------
  check(
    "simulate payout failures on",
    (await cmd(op, "setDemoSettings", { simulatePayoutFailure: true })).body
      .simulatePayoutFailure === true,
  );
  const a21 = await advance(6);
  const dueNow = await q1(
    "select count(*)::int n from payouts where type = 'balance' and trigger = 'day_21_unsold'",
  );
  check(
    "day 21: unsold Sell For More balances become payable",
    a21.counts.balances >= 1 && dueNow.n >= 1,
    `${a21.counts.balances} balances, ${a21.counts.payoutsFailed} failed attempts`,
  );
  await advance(1);
  await advance(1);
  const held = await q1(
    "select p.id, p.attempts, p.status, (select count(*)::int from exception_cases where related_id = p.id and type = 'payment_hold') exceptions, (select count(*)::int from payout_attempts where payout_id = p.id) rows from payouts p where p.type = 'balance' and p.status = 'failed' order by p.updated_date desc limit 1",
  );
  check(
    "3 failed attempts → payout on hold with exactly one exception",
    held?.attempts === 3 && held.exceptions === 1 && held.rows === 3,
    JSON.stringify(held),
  );
  const holdNotes = (
    await q1(
      "select count(*)::int n from notifications where event in ('payout_failed','payout_hold') and link in ('/seller/payouts','/ops')",
    )
  ).n;
  check("seller and ops notified about the hold", holdNotes >= 2);
  check(
    "simulate payout failures off",
    (await cmd(op, "setDemoSettings", { simulatePayoutFailure: false })).body
      .simulatePayoutFailure === false,
  );
  const retry = await cmd(op, "retryPayout", { payoutId: held.id });
  const afterRetry = await q1(
    "select p.status, (select status from exception_cases where related_id = p.id and type = 'payment_hold') exception from payouts p where p.id = $1",
    [held.id],
  );
  check(
    "ops retry pays the held payout and resolves the exception",
    retry.status === 200 && afterRetry.status === "paid" && afterRetry.exception === "resolved",
    JSON.stringify(afterRetry),
  );
  check(
    "retrying a paid payout is refused (409)",
    (await cmd(op, "retryPayout", { payoutId: held.id })).status === 409,
  );
  const dupBalances = await q1(
    "select count(*)::int n from (select device_id from payouts where type = 'balance' group by device_id having count(*) > 1) x",
  );
  check("never more than one balance payout per device", dupBalances.n === 0);
  const overpaid = await q1(
    "select count(*)::int n from (select d.id from devices d join payouts p on p.device_id = d.id where p.type in ('advance','balance','instant_cash_full') group by d.id, d.acquisition_cost having sum(p.amount) > d.acquisition_cost) x",
  );
  check("payouts never exceed the agreed price", overpaid.n === 0);

  // ---- liquidity ---------------------------------------------------------------------------
  const liq = await cmd(op, "recalcLiquidity");
  const current = await q1(
    "select count(*)::int models, count(distinct device_model_id)::int distinct_models from liquidity_scores where is_current",
  );
  check(
    "liquidity recalculated: exactly one current score per model",
    liq.status === 200 && current.models === current.distinct_models && current.models >= 6,
    JSON.stringify(liq.body.counts),
  );

  // ---- notifications bell -------------------------------------------------------------------
  const n1 = (await view(cu, "getNotifications", { limit: "10" })).body;
  check(
    "bell: unread count from the server, latest 10 listed",
    n1.unreadCount > 0 && n1.items.length === 10,
    `${n1.unreadCount} unread`,
  );
  const markOne = await cmd(cu, "markNotificationsRead", {
    ids: [n1.items.find((i) => !i.read).id],
  });
  check("mark one read", markOne.body.updated === 1);
  await cmd(cu, "markNotificationsRead", { all: true });
  check(
    "mark all read",
    (await view(cu, "getNotifications", { limit: "1" })).body.unreadCount === 0,
  );
  check("notifications page renders", (await page(cu, "/notifications")) === 200);
  check("customer cannot run jobs (403)", (await cmd(cu, "runDailyJobs")).status === 403);
  check(
    "cron endpoint is off without CRON_SECRET (404)",
    (await fetch(`${BASE}/api/v1/cron/daily`)).status === 404,
  );
} finally {
  const reset = await cmd(op, "setDemoSettings", { resetClock: true });
  check("demo clock reset to today", reset.body.simDayOffset === 0);
  if (op.factorId) await op.client.auth.mfa.unenroll({ factorId: op.factorId });
  check(
    "temporary MFA factor removed",
    (await q1("select count(*)::int n from auth.mfa_factors")).n === 0,
  );
  await db.end();
}
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
process.exitCode = results.every(Boolean) ? 0 : 1;
