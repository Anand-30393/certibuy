import { AccessDenied, dispatch, homeFor, views } from "@certibuy/application";
import { DomainError } from "@certibuy/domain";
import { notFound, redirect } from "next/navigation";
import { buildContext } from "./context";

/**
 * Load a read model inside a Server Component through the same dispatcher the API uses
 * (same auth, validation and projection). Missing → 404 page; wrong role/owner → own home.
 */
export async function loadView<T>(name: string, input: Record<string, unknown> = {}): Promise<T> {
  const ctx = await buildContext();
  try {
    return (await dispatch(views, name, ctx, input)) as T;
  } catch (e) {
    if (e instanceof DomainError && e.status === 404) notFound();
    if (e instanceof AccessDenied)
      redirect(ctx.actor ? `${homeFor(ctx.actor)}?denied=1` : "/login");
    throw e;
  }
}
