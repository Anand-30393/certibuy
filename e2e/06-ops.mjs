// End-to-end ops console (Phase 7): pages, permissions, settings with history, Instant Cash pause,
// inventory (list / override / liquidate), exceptions, finance reconciliation, support, users,
// invitations, audit and metrics. Restores every setting it changes and removes its invited user.
import crypto from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
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
      friendlyName: `ops-e2e ${Date.now()}`,
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

const db = new Client({ connectionString: env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const q1 = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const cu = await session("demo.customer@certibuy.test");
const te = await session("demo.technician@certibuy.test");
const op = await session("demo.ops@certibuy.test", true);
const INVITE = `e2e.invite.${Date.now()}@certibuy.test`;
const originalCommission = (await q1("select commission_pct from settings where id = 1"))
  .commission_pct;
let pausedModel = null;

try {
  // ---- pages and permissions -----------------------------------------------------------------
  const PAGES = [
    "/ops",
    "/ops/inventory",
    "/ops/orders",
    "/ops/returns",
    "/ops/exceptions",
    "/ops/finance",
    "/ops/liquidity",
    "/ops/catalogue",
    "/ops/pricing",
    "/ops/hubs",
    "/ops/users",
    "/ops/support",
    "/ops/metrics",
    "/ops/audit",
    "/ops/jobs",
    "/ops/mail-log",
    "/ops/inventory?status=listed",
    "/ops/audit?q=price&page=1",
  ];
  const statuses = await Promise.all(PAGES.map((p) => page(op, p)));
  check(
    "all ops console pages render for ops",
    statuses.every((s) => s === 200),
    PAGES.filter((_, i) => statuses[i] !== 200).join(", "),
  );
  const cuStatuses = await Promise.all(
    ["/ops", "/ops/finance", "/ops/users"].map((p) => page(cu, p)),
  );
  check(
    "customer is redirected away from the console",
    cuStatuses.every((s) => s === 307 || s === 303),
  );
  check(
    "customer cannot read ops views (403)",
    (await view(cu, "getFinanceBoard")).status === 403 &&
      (await view(cu, "getAuditLog")).status === 403,
  );
  check(
    "technician cannot read ops views (403)",
    (await view(te, "getOpsOverview")).status === 403 &&
      (await cmd(te, "liquidateDevice", { deviceId: "x" })).status === 403,
  );
  check("help page renders for a customer", (await page(cu, "/help")) === 200);

  // ---- overview and alerts -------------------------------------------------------------------
  const ov = await view(op, "getOpsOverview");
  const listedDb = (await q1("select count(*)::int n from listings where status = 'active'")).n;
  check(
    "overview KPIs come from the records",
    ov.status === 200 && ov.body.kpis.listed === listedDb && ov.body.stockAge.length === 4,
    JSON.stringify(ov.body.kpis),
  );
  check(
    "alerts board loads five groups",
    (await view(op, "getOpsAlerts")).body.groups?.length === 5,
  );

  // ---- business settings ---------------------------------------------------------------------
  const pb = (await view(op, "getPricingBoard")).body;
  check(
    "pricing board hides the demo clock",
    !pb.editable.includes("sim_day_offset") && pb.editable.includes("commission_pct"),
  );
  const bad = await cmd(op, "savePricingSettings", { changes: { step2_day: 10 } });
  check(
    "invalid ladder days refused (400) with a reason",
    bad.status === 400 && /Ladder days/.test(bad.body.error),
  );
  check(
    "demo clock can't be changed from settings (400)",
    (await cmd(op, "savePricingSettings", { changes: { sim_day_offset: 3 } })).status === 400,
  );
  const changed = await cmd(op, "savePricingSettings", {
    changes: { ...pb.settings, commission_pct: originalCommission + 1 },
  });
  const hist = await q1(
    "select settings_version, changes from settings_history order by created_date desc limit 1",
  );
  check(
    "valid change saved with a new version and a history diff",
    changed.status === 200 &&
      changed.body.version === pb.version + 1 &&
      hist.settings_version === changed.body.version &&
      hist.changes.commission_pct?.to === originalCommission + 1,
    JSON.stringify(hist.changes),
  );
  check("only the changed field is recorded", Object.keys(hist.changes).length === 1);
  check(
    "unchanged save refused (400)",
    (await cmd(op, "savePricingSettings", { changes: { commission_pct: originalCommission + 1 } }))
      .status === 400,
  );
  const restored = await cmd(op, "savePricingSettings", {
    changes: { commission_pct: originalCommission },
  });
  check(
    "commission restored",
    restored.status === 200 &&
      (await q1("select commission_pct from settings where id = 1")).commission_pct ===
        originalCommission,
  );

  // ---- liquidity: pause / resume Instant Cash -------------------------------------------------
  const liq = (await view(op, "getLiquidityBoard")).body;
  pausedModel = liq.models.find((m) => !m.icPaused);
  const p1 = await cmd(op, "setIcPaused", { modelId: pausedModel.id, paused: true });
  check(
    "Instant Cash paused for a model",
    p1.status === 200 &&
      (await q1("select ic_paused from device_models where id = $1", [pausedModel.id]))
        .ic_paused === true,
    `${p1.body.affectedOffers} live offers updated`,
  );
  const p2 = await cmd(op, "setIcPaused", { modelId: pausedModel.id, paused: false });
  check(
    "Instant Cash resumed",
    p2.status === 200 &&
      (await q1("select ic_paused from device_models where id = $1", [pausedModel.id]))
        .ic_paused === false,
  );
  pausedModel = null;

  // ---- catalogue and hubs ---------------------------------------------------------------------
  const cat = (await view(op, "getCatalogue")).body.models;
  const m0 = cat[0];
  const modelInput = { ...m0 };
  delete modelInput.icPaused;
  check(
    "catalogue model saves (no-op edit)",
    (await cmd(op, "saveDeviceModel", modelInput)).status === 200,
  );
  check(
    "grade prices rising from A to D refused (400)",
    (await cmd(op, "saveDeviceModel", { ...modelInput, marketPriceB: m0.marketPriceA + 1000 }))
      .status === 400,
  );
  const hub0 = (await view(op, "getHubsBoard")).body.hubs[0];
  const hubInput = { ...hub0 };
  delete hubInput.technicians;
  delete hubInput.bookingsToday;
  check("hub saves (no-op edit)", (await cmd(op, "saveHub", hubInput)).status === 200);
  check(
    "bad pincode refused (400)",
    (await cmd(op, "saveHub", { ...hubInput, pincode: "12" })).status === 400,
  );

  // ---- inventory ------------------------------------------------------------------------------
  const refurb = (await view(op, "getOpsInventory", { status: "in_refurbishment" })).body.items[0];
  if (refurb) {
    const listed = await cmd(op, "markRefurbishedAndList", {
      deviceId: refurb.deviceId,
      partsReplaced: ["battery"],
      resetLadder: true,
    });
    const exp = await q1(
      "select d.status, l.warranty_months, l.base_price from devices d join listings l on l.device_id = d.id and l.status = 'active' where d.id = $1",
      [refurb.deviceId],
    );
    check(
      "refurbished device listed (grade D → no warranty)",
      listed.status === 200 &&
        exp.status === "listed" &&
        (refurb.grade === "D" ? exp.warranty_months === 0 : exp.warranty_months > 0),
      `grade ${refurb.grade}, ${JSON.stringify(exp)}`,
    );
    check(
      "listing again is refused (409)",
      (
        await cmd(op, "markRefurbishedAndList", {
          deviceId: refurb.deviceId,
          partsReplaced: [],
          resetLadder: true,
        })
      ).status === 409,
    );
  } else check("no device in refurbishment to list (skipped)", true);
  const listedItems = (await view(op, "getOpsInventory", { status: "listed" })).body.items.filter(
    (i) => i.listing?.status === "active",
  );
  const target = listedItems[0];
  check(
    "below-floor override refused (400)",
    (
      await cmd(op, "setListingOverride", {
        listingId: target.listing.id,
        price: target.listing.floorPrice - 1,
        reason: "e2e floor test",
      })
    ).status === 400,
  );
  const ovr = await cmd(op, "setListingOverride", {
    listingId: target.listing.id,
    price: target.listing.floorPrice + 500,
    reason: "e2e reprice",
  });
  check(
    "override at or above floor saved",
    ovr.status === 200 &&
      (await q1("select override_price from listings where id = $1", [target.listing.id]))
        .override_price ===
        target.listing.floorPrice + 500,
  );
  check(
    "override cleared",
    (
      await cmd(op, "setListingOverride", {
        listingId: target.listing.id,
        price: null,
        reason: "e2e clear",
      })
    ).status === 200 &&
      (await q1("select override_price from listings where id = $1", [target.listing.id]))
        .override_price === null,
  );
  const victim = listedItems[listedItems.length - 1];
  const liqd = await cmd(op, "liquidateDevice", { deviceId: victim.deviceId });
  const vrow = await q1(
    "select d.status, l.status lstatus from devices d join listings l on l.id = $2 where d.id = $1",
    [victim.deviceId, victim.listing.id],
  );
  check(
    "one-click B2B liquidation at the floor price",
    liqd.status === 200 &&
      liqd.body.proceeds === victim.listing.floorPrice &&
      vrow.status === "liquidated" &&
      vrow.lstatus === "liquidated",
    JSON.stringify(vrow),
  );
  check(
    "liquidating twice refused (409)",
    (await cmd(op, "liquidateDevice", { deviceId: victim.deviceId })).status === 409,
  );
  check(
    "liquidated device no longer in the shop",
    !(await view(cu, "getShopCatalogue", { sort: "price_asc" })).body.items.some(
      (i) => i.listingId === victim.listing.id,
    ),
  );

  // ---- exceptions -----------------------------------------------------------------------------
  const ex = (await view(op, "getExceptionQueue")).body.items;
  check("exception queue loads", Array.isArray(ex), `${ex.length} open`);
  const moneyCase = ex.find((c) => c.type === "return" || c.type === "payment_hold");
  if (moneyCase)
    check(
      "money cases can't be closed by hand (409)",
      (
        await cmd(op, "resolveExceptionCase", {
          caseId: moneyCase.id,
          resolution: "trying to bypass",
        })
      ).status === 409,
    );
  const otherCase = ex.find((c) => c.type === "failed_inspection" || c.type === "grade_dispute");
  if (otherCase) {
    const r = await cmd(op, "resolveExceptionCase", {
      caseId: otherCase.id,
      resolution: "Reviewed in e2e, no action needed.",
    });
    check(
      "non-money case resolved with a resolution",
      r.status === 200 &&
        (await q1("select status from exception_cases where id = $1", [otherCase.id])).status ===
          "resolved",
    );
    check(
      "resolving again refused (409)",
      (
        await cmd(op, "resolveExceptionCase", {
          caseId: otherCase.id,
          resolution: "again and again",
        })
      ).status === 409,
    );
  }

  // ---- finance and escrow ---------------------------------------------------------------------
  const fin = (await view(op, "getFinanceBoard")).body;
  const heldDb = (
    await q1(
      "select coalesce(sum(total),0)::int n from orders where escrow_status in ('hold','held_replacement')",
    )
  ).n;
  check("escrow held matches the orders", fin.escrow.held === heldDb, `₹${fin.escrow.held}`);
  check(
    "all escrow ledgers reconcile",
    fin.anomalies.length === 0,
    JSON.stringify(fin.anomalies.slice(0, 3)),
  );
  check(
    "liquidation proceeds include the B2B sale",
    fin.liquidationProceeds >= victim.listing.floorPrice,
  );
  check(
    "ledger filter: payouts only",
    (await view(op, "getFinanceBoard", { kind: "payout" })).body.ledger.every(
      (r) => r.kind === "payout",
    ),
  );
  check("customer cannot see finance (403)", (await view(cu, "getFinanceBoard")).status === 403);

  // ---- support --------------------------------------------------------------------------------
  const sr = await cmd(cu, "submitSupportRequest", {
    topic: "payments",
    message: "When will my balance be paid? (e2e)",
  });
  check("customer submits a support request", sr.status === 200);
  check(
    "too-short message refused (400)",
    (await cmd(cu, "submitSupportRequest", { topic: "other", message: "hi" })).status === 400,
  );
  const inbox = (await view(op, "getSupportInbox")).body.items;
  check(
    "request arrives in the ops inbox",
    inbox.some((i) => i.id === sr.body.requestId),
  );
  const rep = await cmd(op, "replySupportRequest", {
    requestId: sr.body.requestId,
    reply: "Your balance is paid on day 21. (e2e)",
    resolve: true,
  });
  const mine = (await view(cu, "getMySupport")).body.items.find((i) => i.id === sr.body.requestId);
  check(
    "ops reply reaches the customer and resolves",
    rep.status === 200 && mine.status === "resolved" && /day 21/.test(mine.reply),
  );
  check(
    "customer notified of the reply",
    (
      await q1(
        "select count(*)::int n from notifications where event = 'support_reply' and user_id = (select id from profiles where email = 'demo.customer@certibuy.test')",
      )
    ).n >= 1,
  );
  check(
    "resolving again refused (409)",
    (await cmd(op, "resolveSupportRequest", { requestId: sr.body.requestId })).status === 409,
  );

  // ---- users and invitations ------------------------------------------------------------------
  const ub = (await view(op, "getUsersBoard", { q: "demo." })).body;
  check(
    "users board lists demo accounts; platform admin can manage",
    ub.canManage && ub.users.length >= 3,
  );
  const me = ub.users.find((u) => u.email === "demo.ops@certibuy.test");
  check(
    "can't change own role (409)",
    (
      await cmd(op, "saveUserAccess", {
        userId: me.id,
        appRole: "customer",
        hubId: null,
        trustScore: me.trustScore,
        accountFlagged: false,
      })
    ).status === 409,
  );
  const custRow = ub.users.find((u) => u.email === "demo.customer@certibuy.test");
  check(
    "customer access saved (no-op)",
    (
      await cmd(op, "saveUserAccess", {
        userId: custRow.id,
        appRole: "customer",
        hubId: null,
        trustScore: custRow.trustScore,
        accountFlagged: custRow.accountFlagged,
      })
    ).status === 200,
  );
  check(
    "technician without hub refused (400)",
    (
      await cmd(op, "saveUserAccess", {
        userId: custRow.id,
        appRole: "technician",
        hubId: null,
        trustScore: 50,
        accountFlagged: false,
      })
    ).status === 400,
  );
  const inv = await cmd(op, "inviteStaff", {
    email: INVITE,
    appRole: "technician",
    hubId: "hub_bengaluru_indiranagar",
  });
  check(
    "staff invitation creates a copyable link",
    inv.status === 200 && /^https?:\/\//.test(inv.body.link),
    inv.body.error ?? "",
  );
  check(
    "invitation recorded as pending",
    (await q1("select status from invitations where email = $1", [INVITE]))?.status === "pending",
  );

  // ---- audit and metrics ----------------------------------------------------------------------
  const audit = (await view(op, "getAuditLog", { q: "Pricing settings changed" })).body;
  check(
    "audit log records the settings change with its actor",
    audit.entries.length >= 2 && audit.entries.every((e) => e.actor && e.entity === "settings"),
  );
  const liqAudit = (await view(op, "getAuditLog", { q: "Liquidated", entity: "device" })).body
    .entries;
  check(
    "audit log records the liquidation",
    liqAudit.some((e) => e.entityId === victim.deviceId),
  );
  const mt = (await view(op, "getMetrics")).body;
  check(
    "metrics: nine measures over eight weeks",
    mt.metrics.length === 9 &&
      mt.weeks.length === 8 &&
      mt.metrics.every((m) => m.periods.length === 8),
  );

  // ---- internal numbers never leak to customers ------------------------------------------------
  const mySupport = JSON.stringify((await view(cu, "getMySupport")).body);
  check(
    "customer support view has no internal fields",
    !/floor|acquisition|commission|customer_id/.test(mySupport),
  );
} finally {
  if (pausedModel) await cmd(op, "setIcPaused", { modelId: pausedModel.id, paused: false });
  await db.query("update settings set commission_pct = $1 where id = 1 and commission_pct <> $1", [
    originalCommission,
  ]);
  // Remove the invited test user (auth user, profile, invitation).
  const u = await q1("select id from auth.users where email = $1", [INVITE]);
  if (u) {
    await admin.auth.admin.deleteUser(u.id);
    await db.query("delete from profiles where id = $1", [u.id]);
  }
  await db.query("delete from invitations where email = $1", [INVITE]);
  check(
    "invited test user removed",
    !(await q1("select id from auth.users where email = $1", [INVITE])),
  );
  if (op.factorId) await op.client.auth.mfa.unenroll({ factorId: op.factorId });
  check(
    "temporary MFA factor removed",
    (await q1("select count(*)::int n from auth.mfa_factors")).n === 0,
  );
  await db.end();
}
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
process.exitCode = results.every(Boolean) ? 0 : 1;
