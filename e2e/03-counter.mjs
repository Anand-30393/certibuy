// End-to-end technician counter (Phase 4) against the running app with real Auth, Storage, Postgres.
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

async function session(email) {
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
  if (error) throw new Error("sign-in failed for " + email);
  return { client, ck: () => [...jar].map(([n, v]) => `${n}=${v}`).join("; ") };
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

const cu = await session("demo.customer@certibuy.test");
const cat = (await view(cu, "getSellCatalogue")).body.models;
const iphone = cat.find((m) => m.model === "iPhone 14");

/** Seller side: create → details → 8 photos → checks → grade → accept → book. */
async function prepareDeal({ option, failSellerCheck = false, hubIndex = 0 }) {
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
  const checks = allPass(SELLER_CHECKS);
  if (failSellerCheck) checks.speakers = "fail";
  await cmd(cu, "saveDiagnostics", { submissionId: id, checks, batteryHealth: 92 });
  await cmd(cu, "gradeSubmission", { submissionId: id });
  const acc = await cmd(cu, "acceptOffer", { submissionId: id, option, consent: true });
  const sub = (await view(cu, "getSubmission", { submissionId: id })).body;
  const hub = sub.hubs[hubIndex];
  const date = hub.days[0].date;
  await cmd(cu, "bookInspection", {
    submissionId: id,
    hubId: hub.id,
    date,
    slot: hub.days[0].slots[0],
  });
  return { id, date, hubId: hub.id, agreed: acc.body.amount, band: sub.assessment.band };
}

// Technician with two-step verification (a temporary factor, removed at the end).
const te = await session("demo.technician@certibuy.test");
const enrolled = await te.client.auth.mfa.enroll({
  factorType: "totp",
  friendlyName: `counter-e2e ${Date.now()}`,
});
const verified = await te.client.auth.mfa.challengeAndVerify({
  factorId: enrolled.data.id,
  code: totp(enrolled.data.totp.secret),
});
check("technician completes two-step verification", !verified.error);

const db = new Client({ connectionString: env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const q1 = async (sql, p = []) => (await db.query(sql, p)).rows[0];

async function identity(id, imei = IMEI) {
  return cmd(te, "verifyIdentity", {
    submissionId: id,
    scannedImei: imei,
    activationLockOff: true,
  });
}
async function grade(id, { cosmetic, fails = 0 }) {
  const checklist = allPass(TECH);
  TECH.slice(0, fails).forEach((k) => (checklist[k] = "fail"));
  return cmd(te, "confirmGrade", {
    submissionId: id,
    checklist,
    batteryHealth: 93,
    cosmeticGrade: cosmetic,
  });
}
async function handover(id, tagId = tag()) {
  const up = await cmd(te, "requestSignatureUpload", { submissionId: id });
  const put = await fetch(up.body.signedUrl, {
    method: "PUT",
    headers: { "content-type": "image/png" },
    body: PNG,
  });
  if (!put.ok) return { status: 0, body: { error: "signature upload failed" } };
  return cmd(te, "completeHandover", {
    submissionId: id,
    sealed: true,
    tagId,
    signaturePath: up.body.path,
  });
}

try {
  // ---- A: grade inside the band, Instant Cash ---------------------------------------------
  const A = await prepareDeal({ option: "instant_cash" });
  const queue = await view(te, "getHubQueue", { date: A.date });
  check(
    "T-01 queue lists the booking for the technician's hub",
    queue.status === 200 && queue.body.jobs.some((j) => j.submissionId === A.id),
    `${queue.body.hub?.name}, ${queue.body.jobs.length} jobs`,
  );
  check("T-01 hub queue page renders", (await page(te, `/hub?date=${A.date}`)).status === 200);
  const jobA0 = (await view(te, "getHubJob", { submissionId: A.id })).body;
  check(
    "T-02 job starts at identity; declared IMEI shown as last 4 only",
    jobA0.nextStep === "identity" &&
      jobA0.device.declaredImeiLast4 === "7518" &&
      !JSON.stringify(jobA0).includes(IMEI),
  );
  check(
    "T-03 grading is blocked before identity",
    (await grade(A.id, { cosmetic: "B" })).status === 409,
  );
  const idA = await identity(A.id);
  check(
    "T-02 identity passes with the matching IMEI",
    idA.status === 200 && idA.body.passed && idA.body.imeiMatch,
  );
  const gA = await grade(A.id, { cosmetic: "B" });
  check(
    "T-04 grade B inside band [A,B] → price stands",
    gA.status === 200 &&
      gA.body.finalGrade === "B" &&
      gA.body.verdict === "inside" &&
      gA.body.revised === A.agreed,
    `quoted ₹${gA.body.quoted}`,
  );
  check("T-02…T-06 job page renders", (await page(te, `/hub/${A.id}`)).status === 200);
  const hA = await handover(A.id);
  // iPhone 14 has its own grade-B price ₹47,000; Instant Cash agreed ₹41,400 paid in full.
  check(
    "T-06 handover: device, listing at grade-B price, Instant Cash paid",
    hA.status === 200 &&
      hA.body.listingPrice === 47000 &&
      hA.body.warrantyMonths === 12 &&
      hA.body.paid === A.agreed &&
      hA.body.payoutStatus === "paid",
    `listed ₹${hA.body.listingPrice}, paid ₹${hA.body.paid} (${hA.body.payoutStatus})`,
  );
  const devA = await q1(
    "select d.status, d.acquisition_cost, d.payout_option, l.floor_price, l.base_price from devices d join listings l on l.device_id = d.id where d.submission_id = $1",
    [A.id],
  );
  check(
    "T-06 device listed, cost = agreed price, floor = B2B floor",
    devA?.status === "listed" && devA.acquisition_cost === A.agreed && devA.floor_price === 26000,
    JSON.stringify(devA),
  );
  const payA = await q1(
    "select count(*)::int n, sum(case when status='paid' then 1 else 0 end)::int paid, (select count(*)::int from payout_attempts pa join payouts p2 on p2.id = pa.payout_id where p2.submission_id = $1) attempts from payouts where submission_id = $1",
    [A.id],
  );
  check(
    "T-06 one Instant Cash payout, paid through the simulated rail (1 attempt)",
    payA.n === 1 && payA.paid === 1 && payA.attempts === 1,
  );
  check("T-06 handover cannot run twice", (await handover(A.id)).status === 409);
  const tagA = (await q1("select tag_id from devices where submission_id = $1", [A.id])).tag_id;

  // ---- B: one grade below, seller accepts the revised price, Sell For More -----------------
  const B = await prepareDeal({ option: "sell_for_more" });
  await identity(B.id);
  const gB = await grade(B.id, { cosmetic: "C" });
  // Grade C market = 52,000 × 0.82 = 42,640 → guaranteed 42,640 × 0.85 − 200 = ₹36,044.
  check(
    "T-05 grade C one below [A,B] → revised offer ₹36,044",
    gB.status === 200 && gB.body.verdict === "one_below" && gB.body.revised === 36044,
    `₹${gB.body.quoted} → ₹${gB.body.revised}`,
  );
  const sellerB = (await view(cu, "getSubmission", { submissionId: B.id })).body;
  check(
    "S-14 seller sees the revised price waiting for a decision",
    sellerB.inspection?.verdict === "one_below" &&
      sellerB.inspection.sellerDecision === "pending" &&
      sellerB.inspection.revised === 36044,
  );
  check(
    "S-14 deal page shows the decision panel",
    (await page(cu, `/seller/deals/${B.id}`)).html.includes("Revised price at the counter"),
  );
  const rB = await cmd(te, "reviseOffer", { submissionId: B.id });
  check(
    "T-05 reviseOffer is idempotent (reuses the revised offer)",
    rB.status === 200 && rB.body.reused === true,
  );
  check(
    "handover is blocked until the seller decides",
    (await cmd(te, "requestSignatureUpload", { submissionId: B.id })).status === 409,
  );
  const accB = await cmd(cu, "acceptRevised", { submissionId: B.id });
  check("S-14 seller accepts the revised price", accB.status === 200 && accB.body.amount === 36044);
  check(
    "tag already used on another device is refused",
    (await handover(B.id, tagA)).status === 409,
  );
  const hB = await handover(B.id);
  check(
    "T-06 handover: 50% advance ₹18,022 paid, listed at grade-C price ₹42,640",
    hB.status === 200 &&
      hB.body.paid === 18022 &&
      hB.body.payoutStatus === "paid" &&
      hB.body.listingPrice === 42640,
    `paid ₹${hB.body.paid}, listed ₹${hB.body.listingPrice}`,
  );
  const balB = await q1(
    "select amount, status, to_char(due_on,'YYYY-MM-DD') due_on from payouts where submission_id = $1 and type = 'balance'",
    [B.id],
  );
  check(
    "T-06 Sell For More balance ₹18,022 recorded as due on day 21",
    balB?.amount === 18022 && balB.status === "due" && Boolean(balB.due_on),
    JSON.stringify(balB),
  );
  const sellerPay = (await view(cu, "getSellerPayouts")).body;
  check(
    "S-13 seller payouts show paid and scheduled amounts",
    sellerPay.totals.paid >= 18022 + A.agreed && sellerPay.totals.due >= 18022,
  );

  // ---- C: two grades below → mismatch -------------------------------------------------------
  const C = await prepareDeal({ option: "sell_for_more" });
  await identity(C.id);
  const trustBefore = (
    await q1("select trust_score from profiles where email = 'demo.customer@certibuy.test'")
  ).trust_score;
  const gC = await grade(C.id, { cosmetic: "D" });
  check(
    "T-05 grade D against [A,B] → two below (mismatch)",
    gC.status === 200 && gC.body.verdict === "two_below",
  );
  const mC = await cmd(te, "rejectForMismatch", { submissionId: C.id, feePaid: true });
  check(
    "T-05 mismatch: ₹100 fee recorded, device returned",
    mC.status === 200 && mC.body.fee === 100 && mC.body.feeStatus === "paid",
  );
  const cRow = await q1(
    "select s.status, s.mismatch_fee_status, (select count(*)::int from exception_cases where related_id = s.id) exceptions, (select amount from payouts where submission_id = s.id and type = 'mismatch_fee') fee from submissions s where s.id = $1",
    [C.id],
  );
  const trustAfter = (
    await q1("select trust_score from profiles where email = 'demo.customer@certibuy.test'")
  ).trust_score;
  check(
    "T-05 mismatch: rejected, fee payout, exception raised, trust score −10",
    cRow.status === "rejected" &&
      cRow.mismatch_fee_status === "paid" &&
      cRow.fee === 100 &&
      cRow.exceptions === 1 &&
      trustAfter === trustBefore - 10,
    JSON.stringify(cRow),
  );

  // ---- D: one grade below, seller declines --------------------------------------------------
  const D = await prepareDeal({ option: "sell_for_more" });
  await identity(D.id);
  await grade(D.id, { cosmetic: "C" });
  const decD = await cmd(te, "declineRevised", { submissionId: D.id });
  const dRow = await q1(
    "select s.status, b.status booking from submissions s join bookings b on b.submission_id = s.id where s.id = $1 order by b.created_date desc limit 1",
    [D.id],
  );
  check(
    "S-14 declining the revised price closes the deal and cancels the booking",
    decD.status === 200 && dRow.status === "abandoned" && dRow.booking === "cancelled",
  );
  check(
    "declining twice is idempotent",
    (await cmd(te, "declineRevised", { submissionId: D.id })).body.already === true,
  );

  // ---- E: IMEI mismatch → counter reject -----------------------------------------------------
  const E = await prepareDeal({ option: "sell_for_more" });
  const idE = await identity(E.id, "356938035643809");
  check(
    "T-02 a different IMEI fails identity",
    idE.status === 200 && idE.body.passed === false && idE.body.imeiMatch === false,
  );
  check(
    "T-03 grading stays blocked after a failed identity",
    (await grade(E.id, { cosmetic: "A" })).status === 409,
  );
  const rejE = await cmd(te, "rejectDevice", { submissionId: E.id, reasonCode: "imei_mismatch" });
  const eRow = await q1(
    "select status, reject_reason, (select count(*)::int from exception_cases where related_id = $1) exceptions from submissions where id = $1",
    [E.id],
  );
  check(
    "T-07 reject with reason raises an exception",
    rejE.status === 200 &&
      eRow.status === "rejected" &&
      eRow.exceptions === 1 &&
      eRow.reject_reason.includes("IMEI"),
  );

  // ---- F: grade D inside [C,D] → refurbishment, no listing ----------------------------------
  const F = await prepareDeal({ option: "sell_for_more", failSellerCheck: true });
  check("seller with a failed self-check gets band [C,D]", F.band.join() === "C,D", F.band.join());
  await identity(F.id);
  const gF = await grade(F.id, { cosmetic: "B", fails: 3 });
  check(
    "T-04 three failed checks → grade D, inside [C,D]",
    gF.body.finalGrade === "D" && gF.body.verdict === "inside",
  );
  const hF = await handover(F.id);
  const fRow = await q1(
    "select d.status, (select count(*)::int from listings where device_id = d.id) listings from devices d where d.submission_id = $1",
    [F.id],
  );
  check(
    "T-06 grade D handover: device in refurbishment, no listing (F9)",
    hF.status === 200 &&
      hF.body.listingId === null &&
      fRow.status === "in_refurbishment" &&
      fRow.listings === 0,
  );

  // ---- G: hub scoping ------------------------------------------------------------------------
  const G = await prepareDeal({ option: "sell_for_more", hubIndex: 1 });
  check(
    "technician cannot open a job booked at another hub (403)",
    (await view(te, "getHubJob", { submissionId: G.id })).status === 403,
  );
  check("technician cannot act on another hub's job (403)", (await identity(G.id)).status === 403);
  check(
    "customer cannot run staff commands (403)",
    (
      await cmd(cu, "verifyIdentity", {
        submissionId: G.id,
        scannedImei: IMEI,
        activationLockOff: true,
      })
    ).status === 403,
  );

  // Seller-side tracker after handover
  const trackA = (await view(cu, "getDealTracker", { submissionId: A.id })).body;
  check(
    "S-11 seller tracker shows the paid counter payout and handover in the timeline",
    trackA.payouts.some((p) => p.status === "paid") &&
      trackA.timeline.some((t) => t.text.includes("Handed over")),
  );
  const outbox = await q1(
    "select count(*)::int n from outbox where event in ('custody_complete','inspection_rejected')",
  );
  check(
    "custody and rejection emails queued in the simulated outbox",
    outbox.n >= 3,
    `${outbox.n} rows`,
  );
  console.log(
    `\ndeals: A ${A.id} · B ${B.id} · C ${C.id} · D ${D.id} · E ${E.id} · F ${F.id} · G ${G.id}`,
  );
} finally {
  const u = await te.client.auth.mfa.unenroll({ factorId: enrolled.data.id });
  check("temporary MFA factor removed", !u.error);
  await db.end();
}
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
process.exitCode = results.every(Boolean) ? 0 : 1;
