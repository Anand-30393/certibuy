// POST /api/v1/commands/<name> — the only way money or status changes (docs/api.md.txt).
import { commands, dispatch } from "@certibuy/application";
import { buildContext } from "@/server/context";
import { errorResponse, isSameOrigin, json } from "@/server/http";

export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  if (!isSameOrigin(request)) {
    return json({ error: "Requests must come from the CertiBuy app." }, 403);
  }
  try {
    const { name } = await params;
    const body: unknown = await request.json().catch(() => ({}));
    return json(await dispatch(commands, name, await buildContext(), body));
  } catch (e) {
    return errorResponse(e);
  }
}
