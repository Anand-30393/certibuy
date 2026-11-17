// Phase 8: one device end to end across all four roles, plus concurrency checks on the paths fixed
// in hardening (payout claim, reservation, liquidation, mismatch, return after release).
// Resets the demo clock and removes temporary MFA factors at the end.
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
      friendlyName: `journey ${Date.now()}`,
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
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(512, 1),
]);
const IMEI = "490154203237518";
const SELLER_CHECKS = [
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
const TECH = [
  "screen",
  "touch",
  "speakers",
  "microphone",
  "cameras",
  "charging",
  "buttons",
  "sensors",
  "connectivity",
];
const allPass = (keys) => Object.fromEntries(keys.map((k) => [k, "pass"]));
const tag = () => `CB-${String(crypto.randomInt(0, 100000)).padStart(5, "0")}`;
const DELIVERY = {
  deliveryName: "Demo Customer",
  deliveryPhone: "9876543210",
  deliveryAddress: "12 MG Road, Bengaluru 560001",
  paymentMethod: "upi",
};
const LEAK = /floor|acquisition|commission_split|seller_id|sellerId|buyer_id|buyerId|"cost"/i;

const db = new Client({ connectionString: env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const q1 = async (sql, p = []) => (await db.query(sql, p)).rows[0];

const cu = await session("demo.customer@certibuy.test");
const te = await session("demo.technician@certibuy.test", true);
const op = await session("demo.ops@certibuy.test", true);
const iphone = (await view(cu, "getSellCatalogue")).body.models.find(
  (m) => m.model === "iPhone 14",
);

async function prepareDeal(option) {
  const id = (await cmd(cu, "createSubmission", { deviceModelId: iphone.id })).body.submissionId;
  await cmd(cu, "saveSubmissionDetails", {
    submissionId: id,
    colour: "Black",
    imei: IMEI,
    ageMonths: 12,
    declaredCosmetic: "A",
    repaired: "no",
    waterExposure: false,
    billBox: "bill_and_box",
    warrantyStatus: "expired",
  });
  for (const p of (await view(cu, "getSubmission", { submissionId: id })).body.photos) {
    const up = await cmd(cu, "requestPhotoUpload", { submissionId: id, key: p.key });
    await fetch(up.body.signedUrl, {
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      body: JPEG,
    });
    await cmd(cu, "confirmPhoto", {
      submissionId: id,
      key: p.key,
      path: up.body.path,
      brightness: 150,
      failedAttempts: 0,
    });
  }
  await cmd(cu, "saveDiagnostics", {
    submissionId: id,
    checks: allPass(SELLER_CHECKS),
    batteryHealth: 92,
  });
  await cmd(cu, "gradeSubmission", { submissionId: id });
  const acc = await cmd(cu, "acceptOffer", { submissionId: id, option, consent: true });
  const sub = (await view(cu, "getSubmission", { submissionId: id })).body;
  const hub = sub.hubs.find((h) => h.id === "hub_bengaluru_indiranagar");
  await cmd(cu, "bookInspection", {
    submissionId: id,
    hubId: hub.id,
    date: hub.days[0].date,
    slot: hub.days[0].slots[0],
  });
  return {
    id,
    agreed: acc.body.amount,
    sub: (await view(cu, "getSubmission", { submissionId: id })).body,
  };
}
const grade = (id, cosmetic) =>
  cmd(te, "confirmGrade", {
    submissionId: id,
    checklist: allPass(TECH),
    batteryHealth: 93,
    cosmeticGrade: cosmetic,
  });
async function handover(id) {
  const up = await cmd(te, "requestSignatureUpload", { submissionId: id });
  await fetch(up.body.signedUrl, {
    method: "PUT",
    headers: { "content-type": "image/png" },
    body: PNG,
  });
  return cmd(te, "completeHandover", {
    submissionId: id,
    sealed: true,
    tagId: tag(),
    signaturePath: up.body.path,
  });
}

try {
  await cmd(op, "setDemoSettings", { resetClock: true });

  // ---- 1. Seller → technician → listing (Sell For More) ---------------------------------------
  const S = await prepareDeal("sell_for_more");
  check(
    "seller: graded offer accepted (Sell For More) and hub slot booked",
    S.agreed > 0 && S.sub.status === "scheduled",
    `₹${S.agreed}`,
  );
  check("seller deal view hides internal numbers", !LEAK.test(JSON.stringify(S.sub)));
  await cmd(te, "verifyIdentity", {
    submissionId: S.id,
    scannedImei: IMEI,
    activationLockOff: true,
  });
  const g = await grade(S.id, "B");
  check(
    "technician: grade B inside the quoted band, price stands",
    g.status === 200 && g.body.verdict === "inside" && g.body.revised === S.agreed,
  );
  const h = await handover(S.id);
  check(
    "handover: 50% advance paid at the counter, device listed",
    h.status === 200 &&
      h.body.payoutStatus === "paid" &&
      h.body.paid === Math.round(S.agreed / 2) &&
      Boolean(h.body.listingId),
    `listed ₹${h.body.listingPrice}`,
  );
  const listingId = h.body.listingId;
  const dev = await q1("select id, acquisition_cost from devices where submission_id = $1", [S.id]);
  check(
    "balance recorded as due",
    (await q1("select status from payouts where device_id = $1 and type = 'balance'", [dev.id]))
      .status === "due",
  );

  // ---- 2. Buyer sees it without seller or cost details ------------------------------------------
  const pdp = await view(cu, "getListingDetail", { listingId });
  check(
    "buyer product page: price and grade, no seller, cost or floor",
    pdp.status === 200 && !LEAK.test(JSON.stringify(pdp.body)),
    `status ${pdp.status}`,
  );

  // ---- 3. Concurrent checkout of the same device → one order -----------------------------------
  const [c1, c2] = await Promise.all(
    [1, 2].map(() =>
      cmd(cu, "placeOrders", { items: [{ listingId, warrantyAddon: false }], ...DELIVERY }),
    ),
  );
  const placed = [c1, c2].flatMap((r) => r.body.orders ?? []);
  const orderCount = (
    await q1("select count(*)::int n from orders where listing_id = $1 and status <> 'cancelled'", [
      listingId,
    ])
  ).n;
  check(
    "two simultaneous checkouts reserve the device once",
    placed.length === 1 && orderCount === 1,
    `${placed.length} orders`,
  );
  const o1 = placed[0].orderId;
  check(
    "buyer paying makes the seller balance payable (D4)",
    (await q1("select status from payouts where device_id = $1 and type = 'balance'", [dev.id]))
      .status === "pending",
  );

  // ---- 4. Cancel: full refund, balance back to due, reserved days counted ----------------------
  const cancel = await cmd(cu, "cancelOrder", { orderId: o1 });
  const afterCancel = await q1(
    "select (select status from payouts where device_id = $1 and type = 'balance') balance, l.status, l.reserved_days, l.reserved_since from listings l where l.id = $2",
    [dev.id, listingId],
  );
  check(
    "cancel before dispatch refunds in full",
    cancel.status === 200 && cancel.body.refund === placed[0].total,
  );
  check(
    "unpaid balance goes back to due after the cancel",
    afterCancel.balance === "due",
    afterCancel.balance,
  );
  check(
    "listing back on the shelf with the reserved day counted",
    afterCancel.status === "active" &&
      afterCancel.reserved_days >= 1 &&
      afterCancel.reserved_since === null,
    JSON.stringify(afterCancel),
  );

  // ---- 5. Buy again, deliver --------------------------------------------------------------------
  const again = await cmd(cu, "placeOrders", {
    items: [{ listingId, warrantyAddon: false }],
    ...DELIVERY,
  });
  const o2 = again.body.orders[0].orderId;
  for (let i = 0; i < 3; i++) await cmd(op, "advanceShipment", { orderId: o2 });
  const delivered = await q1("select status, escrow_status from orders where id = $1", [o2]);
  check(
    "order delivered, payment held in escrow",
    delivered.status === "delivered" && delivered.escrow_status === "hold",
  );
  check("buyer order page renders", (await page(cu, `/shop/orders/${o2}`)) === 200);

  // ---- 6. Concurrent payout runs pay the balance once -----------------------------------------
  const [j1, j2] = await Promise.all([
    cmd(op, "runDailyJobs"),
    cmd(op, "retryPayout", {
      payoutId: (
        await q1("select id from payouts where device_id = $1 and type = 'balance'", [dev.id])
      ).id,
    }),
  ]);
  const bal = await q1(
    "select p.status, p.attempts, (select count(*)::int from payout_attempts where payout_id = p.id and status = 'paid') paid_rows from payouts p where p.device_id = $1 and p.type = 'balance'",
    [dev.id],
  );
  check(
    "daily job + ops retry at once: balance paid exactly once",
    bal.status === "paid" && bal.paid_rows === 1,
    `job ${j1.status}, retry ${j2.status}, ${JSON.stringify(bal)}`,
  );
  check(
    "future-dated daily job refused (400)",
    (await cmd(op, "runDailyJobs", { businessDate: "2099-01-01" })).status === 400,
  );

  // ---- 7. Return window closes → escrow released → settled --------------------------------------
  const adv = await cmd(op, "advanceDemoClock", { days: 8 });
  const settled = await q1(
    "select o.status, o.escrow_status, (select count(*)::int from escrow_transactions where order_id = o.id and type = 'release') releases, (select status from devices where id = o.device_id) device from orders o where o.id = $1",
    [o2],
  );
  check(
    "day 8: escrow released once, order and device settled",
    adv.status === 200 &&
      settled.status === "settled" &&
      settled.releases === 1 &&
      settled.device === "settled",
    JSON.stringify(settled),
  );
  const paidTotal = (
    await q1(
      "select coalesce(sum(amount),0)::int n from payouts where device_id = $1 and status = 'paid' and type in ('advance','balance')",
      [dev.id],
    )
  ).n;
  check(
    "seller paid exactly the agreed price (advance + balance)",
    paidTotal === dev.acquisition_cost,
    `₹${paidTotal} of ₹${dev.acquisition_cost}`,
  );
  await cmd(op, "setDemoSettings", { resetClock: true });
  const ret = await cmd(cu, "raiseReturn", { orderId: o2, reason: "buyer_changed_mind" });
  check(
    "clock moved back: a settled order still can't be returned (409)",
    ret.status === 409,
    ret.body.error,
  );

  // ---- 8. Ops: finance, audit, notifications ----------------------------------------------------
  const fin = (await view(op, "getFinanceBoard")).body;
  check(
    "finance: all escrow ledgers reconcile",
    fin.anomalies.length === 0,
    JSON.stringify(fin.anomalies.slice(0, 2)),
  );
  const audit = (await view(op, "getAuditLog", { q: "CB-" + o2.slice(-6).toUpperCase() })).body
    .entries;
  check("audit log has the order's history", audit.length >= 2, `${audit.length} entries`);
  const notes = await q1(
    "select count(*)::int n from notifications where user_id = (select id from profiles where email = 'demo.customer@certibuy.test') and event in ('balance_paid','payout_paid','order_delivered','order_settled','order_cancelled')",
  );
  check("seller and buyer were notified along the way", notes.n >= 3, `${notes.n}`);
  const sellerPay = JSON.stringify((await view(cu, "getSellerPayouts")).body);
  check(
    "seller payouts view hides buyer and internal numbers",
    !/buyerId|buyer_id|buyerName|floor|commission_split|acquisition/i.test(sellerPay),
  );

  // ---- 9. Concurrent liquidation: one wins ------------------------------------------------------
  const L = await prepareDeal("sell_for_more");
  await cmd(te, "verifyIdentity", {
    submissionId: L.id,
    scannedImei: IMEI,
    activationLockOff: true,
  });
  await grade(L.id, "B");
  await handover(L.id);
  const ldev = (await q1("select id from devices where submission_id = $1", [L.id])).id;
  const liq = await Promise.all([1, 2].map(() => cmd(op, "liquidateDevice", { deviceId: ldev })));
  check(
    "two simultaneous liquidations: one succeeds, one is refused",
    liq.filter((r) => r.status === 200).length === 1 &&
      liq.filter((r) => r.status === 409).length === 1,
    liq.map((r) => r.status).join(","),
  );

  // ---- 10. Concurrent mismatch rejection: one fee row ------------------------------------------
  const M = await prepareDeal("sell_for_more");
  await cmd(te, "verifyIdentity", {
    submissionId: M.id,
    scannedImei: IMEI,
    activationLockOff: true,
  });
  await grade(M.id, "D");
  const mm = await Promise.all(
    [1, 2].map(() => cmd(te, "rejectForMismatch", { submissionId: M.id, feePaid: true })),
  );
  const fees = (
    await q1(
      "select count(*)::int n from payouts where submission_id = $1 and type = 'mismatch_fee'",
      [M.id],
    )
  ).n;
  check(
    "double-submitted mismatch rejection writes one fee",
    fees === 1 && mm.some((r) => r.status === 200),
    mm.map((r) => r.status).join(","),
  );
  // ---- 11. Accepted offer not handed over within 7 days → deal closed --------------------------
  const X = await prepareDeal("sell_for_more");
  const xOffer = await q1(
    "select to_char(expires_at,'YYYY-MM-DD') expires, (select to_char(current_date + sim_day_offset, 'YYYY-MM-DD') from settings where id = 1) today from offers where submission_id = $1 and status = 'accepted'",
    [X.id],
  );
  const deadline = new Date(`${xOffer.today}T00:00:00Z`);
  deadline.setUTCDate(deadline.getUTCDate() + 7);
  check(
    "accepting sets a handover deadline 7 days out",
    xOffer.expires === deadline.toISOString().slice(0, 10),
    JSON.stringify(xOffer),
  );
  await cmd(op, "advanceDemoClock", { days: 8 });
  const xRow = await q1(
    "select s.status, (select status from offers where submission_id = s.id order by version desc limit 1) offer, (select count(*)::int from bookings where submission_id = s.id and status = 'booked') live from submissions s where s.id = $1",
    [X.id],
  );
  check(
    "day 8 without handover: offer expired, deal closed, booking cancelled",
    xRow.status === "abandoned" && xRow.offer === "expired" && xRow.live === 0,
    JSON.stringify(xRow),
  );
  check(
    "seller told the accepted offer expired",
    (
      await q1(
        "select count(*)::int n from notifications where event = 'deal_abandoned' and link = $1",
        [`/seller/deals/${X.id}`],
      )
    ).n === 1,
  );
  await cmd(op, "runDailyJobs");
  check(
    "rerun doesn't notify twice",
    (
      await q1(
        "select count(*)::int n from notifications where event = 'deal_abandoned' and link = $1",
        [`/seller/deals/${X.id}`],
      )
    ).n === 1,
  );
  await cmd(op, "setDemoSettings", { resetClock: true });
} finally {
  await cmd(op, "setDemoSettings", { resetClock: true });
  for (const s of [te, op])
    if (s.factorId) await s.client.auth.mfa.unenroll({ factorId: s.factorId });
  check(
    "temporary MFA factors removed, clock reset",
    (await q1("select count(*)::int n from auth.mfa_factors")).n === 0 &&
      (await q1("select sim_day_offset from settings where id = 1")).sim_day_offset === 0,
  );
  await db.end();
}
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
process.exitCode = results.every(Boolean) ? 0 : 1;
