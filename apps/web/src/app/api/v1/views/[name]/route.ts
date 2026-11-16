// GET /api/v1/views/<name> — per-screen read models; only declared fields leave the server.
import { dispatch, views } from "@certibuy/application";
import { buildContext } from "@/server/context";
import { errorResponse, json } from "@/server/http";

export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }) {
  try {
    const { name } = await params;
    const input = Object.fromEntries(new URL(request.url).searchParams);
    return json(await dispatch(views, name, await buildContext(), input));
  } catch (e) {
    return errorResponse(e);
  }
}
