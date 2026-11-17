// End-to-end seller journey against the running app (real Supabase Auth, Storage and Postgres).
import { createServerClient } from "@supabase/ssr";
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const env = process.env;
const results = [];
const check = (label, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
};

async function signIn(email) {
  const jar = new Map();
  const c = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (l) =>
        l.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const { error } = await c.auth.signInWithPassword({ email, password: env.SEED_DEMO_PASSWORD });
  if (error) throw new Error("sign-in failed");
  return () => [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
}
const cmd = async (ck, name, body) => {
  const r = await fetch(`${BASE}/api/v1/commands/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ck(), origin: BASE },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const view = async (ck, name, q = {}) => {
  const r = await fetch(`${BASE}/api/v1/views/${name}?${new URLSearchParams(q)}`, {
    headers: { cookie: ck() },
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const page = async (ck, path) => {
  const r = await fetch(BASE + path, { headers: { cookie: ck() }, redirect: "manual" });
  return { status: r.status, html: await r.text() };
};
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(2048, 7),
  Buffer.from([0xff, 0xd9]),
]);
const ALL_PASS = Object.fromEntries(
  [
    "battery",
    "screen_touch",
    "speakers",
    "microphone",
    "cameras",
    "charging",
    "sensors",
    "imei_blacklist",
    "activation_lock",
  ].map((k) => [k, "pass"]),
);
const DETAILS = {
  colour: "Black",
  imei: "490154203237518",
  ageMonths: 12,
  declaredCosmetic: "A",
  repaired: "no",
  waterExposure: false,
  billBox: "bill_and_box",
  warrantyStatus: "expired",
};

const cu = await signIn("demo.customer@certibuy.test");

// S-02 catalogue
const cat = await view(cu, "getSellCatalogue");
const iphone = cat.body.models?.find((m) => m.model === "iPhone 14");
check(
  "S-02 catalogue lists models with band status",
  cat.status === 200 && iphone?.selectable === true,
  `${cat.body.models?.length} models`,
);

// S-03 create + details
const created = await cmd(cu, "createSubmission", { deviceModelId: iphone.id });
const id = created.body.submissionId;
check(
  "S-02→S-03 creates a draft",
  created.status === 200 && created.body.next === `/seller/sell/${id}`,
);
const badImei = await cmd(cu, "saveSubmissionDetails", {
  submissionId: id,
  ...DETAILS,
  imei: "490154203237519",
});
check("S-03 server rejects an IMEI failing Luhn", badImei.status === 400, badImei.body.error);
const details = await cmd(cu, "saveSubmissionDetails", { submissionId: id, ...DETAILS });
check("S-03 saves details", details.status === 200 && details.body.next.endsWith("/photos"));
check("S-03 details page renders", (await page(cu, `/seller/sell/${id}`)).status === 200);

// S-04 photos
const sub0 = await view(cu, "getSubmission", { submissionId: id });
const shots = sub0.body.photos.map((p) => p.key);
async function upload(subId, key, failedAttempts = 0) {
  const up = await cmd(cu, "requestPhotoUpload", { submissionId: subId, key });
  const put = await fetch(up.body.signedUrl, {
    method: "PUT",
    headers: { "content-type": "image/jpeg" },
    body: JPEG,
  });
  const conf = await cmd(cu, "confirmPhoto", {
    submissionId: subId,
    key,
    path: up.body.path,
    brightness: 140,
    failedAttempts,
  });
  return { up, put, conf };
}
const first = await upload(id, shots[0]);
check(
  "S-04 signed upload to private storage works",
  first.up.status === 200 && first.put.ok && first.conf.status === 200,
  `${first.conf.body.uploaded}/${first.conf.body.required}`,
);
const forged = await cmd(cu, "confirmPhoto", {
  submissionId: id,
  key: shots[1],
  path: `submissions/${id}/${shots[1]}-never-uploaded.jpg`,
  brightness: 140,
  failedAttempts: 0,
});
check(
  "S-04 server refuses a photo that was never uploaded (F5)",
  forged.status === 409,
  forged.body.error,
);
await cmd(cu, "saveDiagnostics", { submissionId: id, checks: ALL_PASS, batteryHealth: 92 });
const early = await cmd(cu, "gradeSubmission", { submissionId: id });
check(
  "S-06 grading refuses missing photos (server-side photo gate)",
  early.status === 400,
  early.body.error?.slice(0, 60),
);
for (const k of shots.slice(1)) await upload(id, k);
const retake = await upload(id, shots[0], 1);
check("S-04 all 8 phone shots stored; a retake counts", retake.conf.body.uploaded === 8);
check("S-04 photos page renders", (await page(cu, `/seller/sell/${id}/photos`)).status === 200);

// S-05/S-06 grade
const graded = await cmd(cu, "gradeSubmission", { submissionId: id });
check(
  "S-06 grades the submission",
  graded.status === 200 && graded.body.ok && graded.body.next.endsWith("/result"),
);
const sub1 = (await view(cu, "getSubmission", { submissionId: id })).body;
check(
  "S-06 estimate A, band [A,B], Medium confidence (2 retakes)",
  sub1.assessment?.estimate === "A" &&
    sub1.assessment.band.join() === "A,B" &&
    sub1.assessment.confidence === "Medium",
  `${sub1.assessment?.estimate} ${sub1.assessment?.band} ${sub1.assessment?.confidence}`,
);
// iPhone 14 grade A ₹52,000: guaranteed 52000×0.85−200 = ₹44,000; high tier cold start 80 → 5% risk → IC ₹41,400.
check(
  "S-07 offer amounts follow the pricing engine",
  sub1.offer?.guaranteedPrice === 44000 &&
    sub1.offer?.instantCashAmount === 41400 &&
    sub1.offer.icEligible,
  `₹${sub1.offer?.guaranteedPrice} / ₹${sub1.offer?.instantCashAmount}`,
);
check(
  "S-07 seller view hides internal numbers",
  !JSON.stringify(sub1, (k, v) => (k === "url" ? undefined : v)).match(
    /floor|acquisition|b2b|modelExposure|inventoryTotal/i,
  ),
);
const resultPage = await page(cu, `/seller/sell/${id}/result`);
const offerPage = await page(cu, `/seller/sell/${id}/offer`);
check(
  "S-06 result page renders the grade",
  resultPage.status === 200 && resultPage.html.includes("grade A"),
);
check(
  "S-07 offer page shows ₹44,000 and ₹41,400",
  offerPage.status === 200 &&
    offerPage.html.includes("₹44,000") &&
    offerPage.html.includes("₹41,400"),
);

// S-09 accept
const noConsent = await cmd(cu, "acceptOffer", {
  submissionId: id,
  option: "instant_cash",
  consent: false,
});
check("S-09 consent is required", noConsent.status === 400);
const accepted = await cmd(cu, "acceptOffer", {
  submissionId: id,
  option: "instant_cash",
  consent: true,
});
check(
  "S-09 accepts Instant Cash",
  accepted.status === 200 && accepted.body.amount === 41400 && accepted.body.next.endsWith("/hub"),
);
check(
  "S-09 cannot accept twice",
  (await cmd(cu, "acceptOffer", { submissionId: id, option: "instant_cash", consent: true }))
    .status === 409,
);

// S-12 booking
const sub2 = (await view(cu, "getSubmission", { submissionId: id })).body;
const hub = sub2.hubs[0];
const day = hub.days[0].date;
const tooLate = await cmd(cu, "bookInspection", {
  submissionId: id,
  hubId: hub.id,
  date: "2030-01-01",
  slot: hub.days[0].slots[0],
});
check("S-12 refuses a day outside the next five", tooLate.status === 422);
const badSlot = await cmd(cu, "bookInspection", {
  submissionId: id,
  hubId: hub.id,
  date: day,
  slot: "03:00",
});
check("S-12 refuses a slot the hub does not offer", badSlot.status === 422);
const booked = await cmd(cu, "bookInspection", {
  submissionId: id,
  hubId: hub.id,
  date: day,
  slot: hub.days[0].slots[0],
});
check(
  "S-12 books a hub slot",
  booked.status === 200 && booked.body.next === `/seller/deals/${id}`,
  `${hub.name} ${day}`,
);
const rebooked = await cmd(cu, "bookInspection", {
  submissionId: id,
  hubId: hub.id,
  date: hub.days[1].date,
  slot: hub.days[1].slots[1],
});
check("S-12 rebooking replaces the live booking", rebooked.status === 200);
const switched = await cmd(cu, "manageBooking", {
  submissionId: id,
  action: "switch_to_guaranteed",
});
check("S-12 switches Instant Cash to Sell For More", switched.status === 200);

// S-11 tracker, S-01 home, S-13 payouts
const tracker = (await view(cu, "getDealTracker", { submissionId: id })).body;
check(
  "S-11 tracker: scheduled, Sell For More, booking, timeline",
  tracker.submission?.status === "scheduled" &&
    tracker.submission.chosenOption === "sell_for_more" &&
    tracker.submission.booking?.status === "booked" &&
    tracker.timeline.length >= 4,
  `${tracker.timeline?.length} timeline entries`,
);
const trackerPage = await page(cu, `/seller/deals/${id}`);
check(
  "S-11 deal page renders the 50/50 split (₹22,000 each)",
  trackerPage.status === 200 && (trackerPage.html.match(/₹22,000/g) ?? []).length >= 2,
);
const home = (await view(cu, "getSellerHome")).body;
check(
  "S-01 home lists the deal with its next action",
  home.deals?.some((d) => d.id === id && d.status === "scheduled"),
);
check("S-01 seller page renders", (await page(cu, "/seller")).status === 200);
const pay = await view(cu, "getSellerPayouts");
check(
  "S-13 payouts view works (empty until handover)",
  pay.status === 200 && Array.isArray(pay.body.payouts),
);
check("S-13 payouts page renders", (await page(cu, "/seller/payouts")).status === 200);

// Hard reject path
const c2 = await cmd(cu, "createSubmission", { deviceModelId: iphone.id });
const id2 = c2.body.submissionId;
await cmd(cu, "saveSubmissionDetails", {
  submissionId: id2,
  ...DETAILS,
  colour: "White",
  declaredCosmetic: "B",
  waterExposure: true,
});
const s2 = (await view(cu, "getSubmission", { submissionId: id2 })).body;
for (const p of s2.photos) await upload(id2, p.key);
await cmd(cu, "saveDiagnostics", { submissionId: id2, checks: ALL_PASS, batteryHealth: 88 });
const rej = await cmd(cu, "gradeSubmission", { submissionId: id2 });
check(
  "S-06 water exposure is a hard reject",
  rej.status === 200 && rej.body.rejected && rej.body.code === "water_exposure",
);
check(
  "S-06 reject page explains why",
  (await page(cu, `/seller/sell/${id2}/result`)).html.includes("exposed to water"),
);

// Access control
const te = await signIn("demo.technician@certibuy.test");
check(
  "technician cannot read a seller's submission (403)",
  (await view(te, "getSubmission", { submissionId: id })).status === 403,
);

// Profile
const prof = await cmd(cu, "updateProfile", {
  fullName: "Demo Customer",
  phone: "9876543210",
  city: "Bengaluru",
  payoutAccount: "democustomer@upi",
  deliveryAddress: "12 MG Road, Bengaluru 560001",
});
check(
  "X-06 profile saves",
  prof.status === 200 && (await view(cu, "getProfile")).body.city === "Bengaluru",
);
check(
  "X-06 invalid phone is refused",
  (
    await cmd(cu, "updateProfile", {
      fullName: "Demo Customer",
      phone: "12345",
      city: "",
      payoutAccount: "",
      deliveryAddress: "",
    })
  ).status === 400,
);

console.log(`\nsubmission ids: ${id} (scheduled), ${id2} (rejected)`);
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
process.exitCode = results.every(Boolean) ? 0 : 1;
