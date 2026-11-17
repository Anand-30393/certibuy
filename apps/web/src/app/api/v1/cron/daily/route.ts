// Optional free daily cron (off by default, docs/architecture.md §13). Enabled only when
// CRON_SECRET is set; the scheduler sends `Authorization: Bearer <CRON_SECRET>`.
import { runDailyJob } from "@certibuy/application";
import { errorResponse, json } from "@/server/http";
import { buildContext } from "@/server/context";

async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: "Not found." }, 404);
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return json({ error: "Not authorised." }, 401);
  }
  try {
    const ctx = { ...(await buildContext()), actor: null };
    return json({ ok: true, ...(await runDailyJob(ctx)) });
  } catch (e) {
    return errorResponse(e);
  }
}

export const GET = handle;
export const POST = handle;
