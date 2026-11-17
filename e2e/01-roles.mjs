// End-to-end role check against the running app. Prints results only, never secrets.
import crypto from "node:crypto";
import { createServerClient } from "@supabase/ssr";
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const env = process.env;

async function signIn(email) {
  const jar = new Map();
  const client = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (list) =>
          list.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
      },
    },
  );
  const { error } = await client.auth.signInWithPassword({
    email,
    password: env.SEED_DEMO_PASSWORD,
  });
  if (error) throw new Error(`sign-in failed for ${email}`);
  return { client, jar, cookie: () => [...jar].map(([n, v]) => `${n}=${v}`).join("; ") };
}

const results = [];
function check(label, ok, detail) {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
}

async function page(s, path) {
  const r = await fetch(BASE + path, {
    redirect: "manual",
    headers: s ? { cookie: s.cookie() } : {},
  });
  return { status: r.status, location: r.headers.get("location")?.replace(BASE, "") ?? "" };
}
async function api(s, method, path, body, origin = true) {
  const headers = {
    "content-type": "application/json",
    ...(s ? { cookie: s.cookie() } : {}),
    ...(origin ? { origin: BASE } : {}),
  };
  const r = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const expectRedirect = async (s, path, to, label) => {
  const r = await page(s, path);
  check(
    label,
    r.status >= 300 && r.status < 400 && r.location.startsWith(to),
    `${r.status} → ${r.location}`,
  );
};
const expectOk = async (s, path, label) => {
  const r = await page(s, path);
  check(label, r.status === 200, String(r.status));
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
async function withMfa(s, fn) {
  const { data, error } = await s.client.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `smoke ${Date.now()}`,
  });
  if (error) throw error;
  const v = await s.client.auth.mfa.challengeAndVerify({
    factorId: data.id,
    code: totp(data.totp.secret),
  });
  if (v.error) throw v.error;
  try {
    await fn();
  } finally {
    const u = await s.client.auth.mfa.unenroll({ factorId: data.id });
    check("test MFA factor removed again", !u.error);
  }
}

// Signed out
await expectRedirect(null, "/", "/login?returnTo=", "signed-out visitor is sent to /login");
check(
  "signed-out API call is refused (401)",
  (await api(null, "GET", "/api/v1/views/getMe")).status === 401,
);

// Customer (seller + buyer)
const cu = await signIn("demo.customer@certibuy.test");
await expectRedirect(cu, "/", "/welcome", "customer without a mode gets the chooser");
await expectOk(cu, "/seller", "customer opens /seller");
await expectOk(cu, "/shop", "customer opens /shop");
await expectRedirect(cu, "/hub", "/welcome?denied=1", "customer is bounced from /hub");
await expectRedirect(cu, "/ops", "/welcome?denied=1", "customer is bounced from /ops");
const me = await api(cu, "GET", "/api/v1/views/getMe");
check(
  "getMe projects only declared fields",
  me.status === 200 && me.body.appRole === "customer" && !("aal" in me.body),
  Object.keys(me.body).join(","),
);
check(
  "command without Origin is refused (403)",
  (await api(cu, "POST", "/api/v1/commands/setActiveMode", { mode: "seller" }, false)).status ===
    403,
);
check(
  "invalid input is refused (400)",
  (await api(cu, "POST", "/api/v1/commands/setActiveMode", { mode: "trader" })).status === 400,
);
check(
  "unknown command is 404",
  (await api(cu, "POST", "/api/v1/commands/doesNotExist", {})).status === 404,
);
const set = await api(cu, "POST", "/api/v1/commands/setActiveMode", { mode: "seller" });
check("customer saves selling mode", set.status === 200 && set.body.home === "/seller");
await expectRedirect(cu, "/", "/seller", "customer now lands on /seller");
const ws = await api(cu, "GET", "/api/v1/views/getWorkspaceContext");
check(
  "workspace context: business date + all integrations simulated",
  ws.status === 200 &&
    /^\d{4}-\d{2}-\d{2}$/.test(ws.body.businessDate) &&
    Object.values(ws.body.integrations).every((m) => m === "simulated"),
  ws.body.businessDate,
);

// Technician
const te = await signIn("demo.technician@certibuy.test");
await expectRedirect(te, "/", "/hub", "technician lands on /hub");
await expectRedirect(te, "/hub", "/mfa?returnTo=", "technician without MFA is sent to /mfa");
await expectRedirect(te, "/seller", "/hub?denied=1", "technician is bounced from /seller");
check(
  "technician cannot run a customer command (403)",
  (await api(te, "POST", "/api/v1/commands/setActiveMode", { mode: "buyer" })).status === 403,
);
await withMfa(te, async () => {
  await expectOk(te, "/hub", "technician with MFA opens /hub");
  await expectRedirect(
    te,
    "/ops",
    "/hub?denied=1",
    "technician with MFA is still bounced from /ops",
  );
});

// Operations (platform admin)
const op = await signIn("demo.ops@certibuy.test");
await expectRedirect(op, "/", "/ops", "ops lands on /ops");
await expectRedirect(op, "/ops", "/mfa?returnTo=", "ops without MFA is sent to /mfa");
await withMfa(op, async () => {
  await expectOk(op, "/ops", "ops with MFA opens /ops");
  await expectOk(op, "/hub", "ops with MFA opens /hub");
  await expectOk(op, "/seller", "platform admin can preview /seller");
});

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exitCode = results.every(Boolean) ? 0 : 1;
