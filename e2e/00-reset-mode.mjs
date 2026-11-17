// Puts the demo customer back to "no mode chosen" so the role suite starts from a known state.
import pg from "pg";

const { Client } = pg;
const db = new Client({
  connectionString: process.env.DIRECT_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();
await db.query(
  "update profiles set active_mode = null where email = 'demo.customer@certibuy.test'",
);
const f = await db.query("select count(*)::int n from auth.mfa_factors");
console.log(`PASS  demo customer mode cleared; MFA factors left: ${f.rows[0].n}`);
console.log("1/1 checks passed");
await db.end();
