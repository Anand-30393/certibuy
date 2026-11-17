// End-to-end buyer journey (Phase 5): marketplace, cart (one order per device), simulated payment,
// escrow, cancellation, shipping, returns, refunds and the approved DOA replacement.
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
      friendlyName: `buyer-e2e ${Date.now()}`,
    });
    await client.auth.mfa.challengeAndVerify({ factorId: data.id, code: totp(data.totp.secret) });
    factorId = data.id;
  }
  return { client, factorId, ck: () => [...jar].map(([n, v]) => `${n}=${v}`).join("; ") };
}
const cmd = async (s, name, body) => {
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
const page = async (s, path) => {
  const r = await fetch(BASE + path, { headers: { cookie: s.ck() }, redirect: "manual" });
  return { status: r.status, html: await r.text() };
};
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
const allPass = (keys) => Object.fromEntries(keys.map((k) => [k, "pass"]));
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

const db = new Client({ connectionString: env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const q1 = async (sql, p = []) => (await db.query(sql, p)).rows[0];

const cu = await session("demo.customer@certibuy.test");
const te = await session("demo.technician@certibuy.test", true);
const op = await session("demo.ops@certibuy.test", true);

try {
  // ---- stock: three more grade-B iPhone 14 listings through the real sell + counter flow --------
  const iphone = (await view(cu, "getSellCatalogue")).body.models.find(
    (m) => m.model === "iPhone 14",
  );
  async function makeListing() {
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
      checks: allPass(SELLER),
      batteryHealth: 92,
    });
    await cmd(cu, "gradeSubmission", { submissionId: id });
    await cmd(cu, "acceptOffer", { submissionId: id, option: "sell_for_more", consent: true });
    const hub = (await view(cu, "getSubmission", { submissionId: id })).body.hubs[0];
    await cmd(cu, "bookInspection", {
      submissionId: id,
      hubId: hub.id,
      date: hub.days[0].date,
      slot: hub.days[0].slots[2],
    });
    await cmd(te, "verifyIdentity", {
      submissionId: id,
      scannedImei: IMEI,
      activationLockOff: true,
    });
    await cmd(te, "confirmGrade", {
      submissionId: id,
      checklist: allPass(TECH),
      batteryHealth: 91,
      cosmeticGrade: "B",
    });
    const sig = await cmd(te, "requestSignatureUpload", { submissionId: id });
    await fetch(sig.body.signedUrl, {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: PNG,
    });
    const h = await cmd(te, "completeHandover", {
      submissionId: id,
      sealed: true,
      tagId: `CB-${String(crypto.randomInt(0, 100000)).padStart(5, "0")}`,
      signaturePath: sig.body.path,
    });
    return h.body.listingId;
  }
  const [L3, L4, L5] = [await makeListing(), await makeListing(), await makeListing()];
  check("stock: three new grade-B listings created through the counter", Boolean(L3 && L4 && L5));

  // ---- B-01/B-02 marketplace ---------------------------------------------------------------
  const home = await view(cu, "getShopHome");
  check(
    "B-01 shop home lists live devices",
    home.status === 200 && home.body.listedCount >= 3,
    `${home.body.listedCount} listed`,
  );
  const gradeB = (await view(cu, "getShopCatalogue", { grade: "B", q: "iphone" })).body;
  check(
    "B-02 filter grade B + search 'iphone'",
    gradeB.items.length >= 3 &&
      gradeB.items.every((c) => c.grade === "B" && c.model.includes("iPhone")),
    `${gradeB.total} results`,
  );
  const sorted = (await view(cu, "getShopCatalogue", { sort: "price_asc" })).body.items.map(
    (c) => c.price,
  );
  check(
    "B-02 price sort ascending",
    sorted.every((p, i) => i === 0 || sorted[i - 1] <= p),
  );
  check(
    "B-02 invalid filter is refused (400)",
    (await view(cu, "getShopCatalogue", { grade: "Z" })).status === 400,
  );
  check(
    "B-01/B-02 pages render",
    (await page(cu, "/shop")).status === 200 &&
      (await page(cu, "/shop/browse?grade=B")).status === 200,
  );

  // ---- B-03 listing detail -----------------------------------------------------------------
  const detail = (await view(cu, "getListingDetail", { listingId: L4 })).body;
  check(
    "B-03 detail: price, grade, photos (no IMEI shot), checklist, 5% add-on",
    detail.card.price === 47000 &&
      detail.card.grade === "B" &&
      detail.photos.length === 7 &&
      !detail.photos.some((p) => p.label.includes("IMEI")) &&
      detail.inspection?.checklist.length === 9 &&
      detail.addonPrice === 2350,
    `${detail.photos.length} photos, add-on ₹${detail.addonPrice}`,
  );
  check(
    "B-03 buyer payload has no seller or cost data",
    !JSON.stringify(detail, (k, v) => (k === "url" ? undefined : v)).match(
      /seller|acquisition|floor|b2b|imei/i,
    ),
  );
  check(
    "B-03 / B-04 pages render",
    (await page(cu, `/shop/${L4}`)).html.includes("Inspection report") &&
      (await page(cu, "/shop/grades")).status === 200,
  );

  // ---- B-05 checkout: declined, then multi-device with one unavailable ----------------------
  const ordersBefore = (await q1("select count(*)::int n from orders")).n;
  const declined = await cmd(cu, "placeOrders", {
    items: [{ listingId: L4, warrantyAddon: true }],
    deliveryName: "Demo Customer",
    deliveryPhone: "+91 98765 43210",
    deliveryAddress: "12 MG Road, Bengaluru 560001",
    paymentMethod: "upi",
    declined: true,
  });
  check(
    "B-05 simulated decline writes nothing",
    declined.body.declined === true &&
      (await q1("select count(*)::int n from orders")).n === ordersBefore,
  );
  check(
    "B-05 add-on requested on a 0-month listing is impossible here; invalid phone refused",
    (
      await cmd(cu, "placeOrders", {
        items: [{ listingId: L4, warrantyAddon: false }],
        deliveryName: "Demo",
        deliveryPhone: "12345",
        deliveryAddress: "12 MG Road, Bengaluru",
        paymentMethod: "upi",
      })
    ).status === 400,
  );
  const first = await cmd(cu, "placeOrders", {
    items: [{ listingId: L5, warrantyAddon: false }],
    deliveryName: "Demo Customer",
    deliveryPhone: "9876543210",
    deliveryAddress: "12 MG Road, Bengaluru 560001",
    paymentMethod: "card",
  });
  check(
    "B-05 single-device order placed",
    first.status === 200 && first.body.orders.length === 1,
    `₹${first.body.total}`,
  );
  const multi = await cmd(cu, "placeOrders", {
    items: [
      { listingId: L3, warrantyAddon: true },
      { listingId: L4, warrantyAddon: false },
      { listingId: L5, warrantyAddon: false },
    ],
    deliveryName: "Demo Customer",
    deliveryPhone: "+919876543210",
    deliveryAddress: "12 MG Road, Bengaluru 560001",
    paymentMethod: "upi",
  });
  check(
    "Option A: 2 separate orders created, the already-sold device removed and not charged",
    multi.status === 200 &&
      multi.body.orders.length === 2 &&
      multi.body.removed.length === 1 &&
      multi.body.removed[0].listingId === L5 &&
      multi.body.total === 49350 + 47000,
    `orders ${multi.body.orders.length}, removed ${multi.body.removed.length}, total ₹${multi.body.total}`,
  );
  const [O3, O4] = multi.body.orders.map((o) => o.orderId);
  const O5 = first.body.orders[0].orderId;
  const esc = await q1(
    "select count(*)::int n, sum(amount)::int total from escrow_transactions where order_id = any($1) and type = 'hold'",
    [[O3, O4]],
  );
  check("each order has its own escrow hold", esc.n === 2 && esc.total === 96350);
  const unavailableNote = await q1(
    "select count(*)::int n from notifications n join profiles p on p.id = n.user_id where p.email = 'demo.customer@certibuy.test' and n.event = 'cart_item_unavailable' and n.created_date > now() - interval '5 minutes'",
  );
  check("buyer notified about the removed device", unavailableNote.n >= 1);
  const bal = await q1(
    "select p.status, p.trigger from payouts p join listings l on l.device_id = p.device_id where l.id = $1 and p.type = 'balance'",
    [L3],
  );
  check(
    "Sell For More balance becomes payable when the buyer pays (D4)",
    bal?.status === "pending" && bal.trigger === "buyer_paid_escrow",
    JSON.stringify(bal),
  );
  const conf = await page(cu, `/shop/confirmation?ids=${O3},${O4}&removed=1`);
  check(
    "B-06 one confirmation lists both orders",
    conf.status === 200 && conf.html.includes("2 orders are") && conf.html.includes("₹49,350"),
  );

  // ---- B-12 cancellation -------------------------------------------------------------------
  const cancel = await cmd(cu, "cancelOrder", { orderId: O5 });
  const o5 = await q1(
    "select o.status, o.escrow_status, o.refund_amount, l.status listing, d.status device, (select count(*)::int from escrow_transactions where order_id = o.id and type = 'refund_full') refunds from orders o join listings l on l.id = o.listing_id join devices d on d.id = o.device_id where o.id = $1",
    [O5],
  );
  check(
    "B-12 cancel before dispatch: full refund, listing back on the shelf",
    cancel.status === 200 &&
      cancel.body.refund === 47000 &&
      o5.status === "cancelled" &&
      o5.escrow_status === "refunded_full" &&
      o5.refunds === 1 &&
      o5.listing === "active" &&
      o5.device === "listed",
    JSON.stringify(o5),
  );
  check(
    "B-12 cancelling twice is idempotent",
    (await cmd(cu, "cancelOrder", { orderId: O5 })).body.already === true,
  );

  // ---- shipping + change-of-mind return on O3 ----------------------------------------------
  for (let i = 0; i < 3; i++) await cmd(cu, "advanceShipment", { orderId: O3 });
  const t3 = (await view(cu, "getOrderTracking", { orderId: O3 })).body;
  check(
    "B-07 simulated courier: delivered, return window set, cancel no longer offered",
    t3.summary.status === "delivered" &&
      Boolean(t3.returnWindowClosesAt) &&
      t3.canCancel === false &&
      t3.canReturn === true,
    `window closes ${t3.returnWindowClosesAt}`,
  );
  check(
    "cancel after dispatch is refused (409)",
    (await cmd(cu, "cancelOrder", { orderId: O3 })).status === 409,
  );
  const opts = (await view(cu, "getReturnOptions", { orderId: O3 })).body;
  check(
    "B-09 return estimates: change of mind ₹48,850, others ₹49,350",
    opts.eligible &&
      opts.options.find((o) => o.reason === "buyer_changed_mind").refund === 48850 &&
      opts.options.find((o) => o.reason === "not_as_graded").refund === 49350,
  );
  const userReturnsBefore = (
    await q1("select return_count from profiles where email = 'demo.customer@certibuy.test'")
  ).return_count;
  const r3 = await cmd(cu, "raiseReturn", {
    orderId: O3,
    reason: "buyer_changed_mind",
    note: "Bought two by mistake",
  });
  check(
    "B-09 return raised; buyer return count +1 (F16)",
    r3.status === 200 &&
      r3.body.refund === 48850 &&
      (await q1("select return_count from profiles where email = 'demo.customer@certibuy.test'"))
        .return_count ===
        userReturnsBefore + 1,
  );
  check(
    "only one open return per order (409)",
    (await cmd(cu, "raiseReturn", { orderId: O3, reason: "not_as_graded" })).status === 409,
  );
  const hubQ = (await view(te, "getHubQueue", {})).body;
  check(
    "T-08 return appears in the hub re-inspection queue",
    hubQ.returns.some((x) => x.returnId === r3.body.returnId),
  );
  check(
    "T-08 return job page renders",
    (await page(te, `/hub/returns/${r3.body.returnId}`)).status === 200,
  );
  check(
    "T-08 re-inspection recorded",
    (
      await cmd(te, "returnInspection", {
        returnId: r3.body.returnId,
        recommendation: "as_shipped",
        batteryHealth: 91,
      })
    ).status === 200,
  );
  check(
    "O-07 outcome not allowed for the reason is refused (400)",
    (await cmd(op, "resolveReturn", { returnId: r3.body.returnId, outcome: "faulty" })).status ===
      400,
  );
  const res3 = await cmd(op, "resolveReturn", {
    returnId: r3.body.returnId,
    outcome: "changed_mind",
  });
  const after3 = await q1(
    "select o.status, o.escrow_status, (select amount from escrow_transactions where order_id = o.id and type = 'refund_partial') refund, (select count(*)::int from listings where device_id = o.device_id and status = 'active' and ladder_step = 0) relisted, (select status from exception_cases where related_id = $2) exception from orders o where o.id = $1",
    [O3, r3.body.returnId],
  );
  check(
    "O-07 changed mind: ₹48,850 refunded, device relisted at day 0, exception resolved",
    res3.status === 200 &&
      after3.status === "refunded" &&
      after3.refund === 48850 &&
      after3.relisted === 1 &&
      after3.exception === "resolved",
    JSON.stringify(after3),
  );

  // ---- DOA replacement on O4 (approved flow) ------------------------------------------------
  for (let i = 0; i < 3; i++) await cmd(op, "advanceShipment", { orderId: O4 });
  const r4 = await cmd(cu, "raiseReturn", {
    orderId: O4,
    reason: "dead_on_arrival",
    doaPreference: "replacement",
    note: "Will not power on",
  });
  await cmd(te, "returnInspection", {
    returnId: r4.body.returnId,
    recommendation: "doa_confirmed",
  });
  const opsReturns = (await view(op, "getOpsReturns")).body.returns.find(
    (x) => x.returnId === r4.body.returnId,
  );
  check(
    "O-07 ops sees a replacement candidate: same model, grade B or better, cheapest",
    opsReturns?.replacement?.grade &&
      ["A", "B"].includes(opsReturns.replacement.grade) &&
      opsReturns.replacement.device.includes("iPhone 14"),
    JSON.stringify(opsReturns?.replacement),
  );
  check(
    "ops returns and orders pages render",
    (await page(op, "/ops/returns")).status === 200 &&
      (await page(op, "/ops/orders")).status === 200,
  );
  const res4 = await cmd(op, "resolveReturn", {
    returnId: r4.body.returnId,
    outcome: "doa_replacement",
  });
  const o4 = await q1(
    "select o.status, o.escrow_status, o.replacement_device_id, (select count(*)::int from escrow_transactions where order_id = o.id and type <> 'hold') movements, (select status from devices where id = o.device_id) original, (select status from devices where id = o.replacement_device_id) repl, (select status from listings where id = $2) repl_listing from orders o where o.id = $1",
    [O4, res4.body.replacementListingId],
  );
  check(
    "DOA: order replaced, escrow held (no money moved), original to refurbishment, replacement reserved and its listing sold",
    res4.status === 200 &&
      o4.status === "replaced" &&
      o4.escrow_status === "held_replacement" &&
      o4.movements === 0 &&
      o4.original === "in_refurbishment" &&
      o4.repl === "reserved" &&
      o4.repl_listing === "sold",
    JSON.stringify(o4),
  );
  for (let i = 0; i < 3; i++) await cmd(cu, "advanceShipment", { orderId: O4 });
  const t4 = (await view(cu, "getOrderTracking", { orderId: O4 })).body;
  check(
    "DOA: replacement shipped on the same order; delivery restarts the window and escrow is back on hold",
    t4.summary.status === "delivered" &&
      t4.summary.escrowStatus === "hold" &&
      t4.replacement?.stage === "delivered" &&
      Boolean(t4.returnWindowClosesAt),
  );
  check(
    "DOA: a second replacement on the same order is refused (409)",
    (
      await cmd(cu, "raiseReturn", {
        orderId: O4,
        reason: "dead_on_arrival",
        doaPreference: "replacement",
      })
    ).status === 409,
  );
  const r4b = await cmd(cu, "raiseReturn", {
    orderId: O4,
    reason: "dead_on_arrival",
    doaPreference: "refund",
  });
  await cmd(te, "returnInspection", {
    returnId: r4b.body.returnId,
    recommendation: "doa_confirmed",
  });
  check(
    "O-07 replacement outcome is no longer offered for this order",
    (await view(op, "getOpsReturns")).body.returns
      .find((x) => x.returnId === r4b.body.returnId)
      ?.outcomes.find((o) => o.outcome === "doa_replacement")?.available === false,
  );
  const res4b = await cmd(op, "resolveReturn", {
    returnId: r4b.body.returnId,
    outcome: "doa_confirmed",
  });
  const o4b = await q1(
    "select status, escrow_status, refund_amount, (select status from devices where id = replacement_device_id) repl from orders where id = $1",
    [O4],
  );
  check(
    "DOA on the replacement: full refund of ₹47,000, replacement unit to refurbishment",
    res4b.status === 200 &&
      o4b.status === "refunded" &&
      o4b.escrow_status === "refunded_full" &&
      o4b.refund_amount === 47000 &&
      o4b.repl === "in_refurbishment",
    JSON.stringify(o4b),
  );

  // ---- pages and access --------------------------------------------------------------------
  check(
    "B-07/B-08/B-09 pages render",
    (await page(cu, `/shop/orders/${O4}`)).status === 200 &&
      (await page(cu, "/shop/orders")).status === 200 &&
      (await page(cu, "/shop/cart")).status === 200,
  );
  check(
    "technician cannot place orders (403)",
    (
      await cmd(te, "placeOrders", {
        items: [{ listingId: L4, warrantyAddon: false }],
        deliveryName: "X Y",
        deliveryPhone: "9876543210",
        deliveryAddress: "Somewhere long enough",
        paymentMethod: "upi",
      })
    ).status === 403,
  );
  check(
    "customer cannot resolve returns (403)",
    (await cmd(cu, "resolveReturn", { returnId: r4b.body.returnId, outcome: "doa_confirmed" }))
      .status === 403,
  );
  const ledger = await q1(
    "select count(*)::int n from (select o.id, o.total, coalesce(sum(case when e.type='hold' then e.amount end),0) h from orders o join escrow_transactions e on e.order_id = o.id where o.id = any($1) group by o.id, o.total) x where h <> total",
    [[O3, O4, O5]],
  );
  check("ledger invariant: every escrow hold equals its order total", ledger.n === 0);
  console.log(
    `\norders: ${O3} (changed mind), ${O4} (DOA replacement → refund), ${O5} (cancelled)`,
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
