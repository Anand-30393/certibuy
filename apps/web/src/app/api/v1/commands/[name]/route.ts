// POST /api/v1/commands/<name> — the only way money or status changes (docs/api.md.txt).
import { commands, dispatch, processOutbox } from "@certibuy/application";
import { buildContext } from "@/server/context";
import { errorResponse, isSameOrigin, json } from "@/server/http";

export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  if (!isSameOrigin(request)) {
    return json({ error: "Requests must come from the CertiBuy app." }, 403);
  }
  try {
    const { name } = await params;
    const body: unknown = await request.json().catch(() => ({}));
    const ctx = await buildContext();
    const result = await dispatch(commands, name, ctx, body);
    // Deliver any email this command queued (simulated). Best effort: never fails the command.
    await processOutbox(ctx).catch(() => 0);
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
