// Command and view registry: one shared wrapper enforces auth, role, MFA and input validation
// before any handler runs (docs/architecture.md §6). Route handlers only call `dispatch`.
import type { AppRole } from "@certibuy/contracts";
import { DomainError } from "@certibuy/domain";
import type { z } from "zod";
import type { Actor } from "./actor";
import type { AppContext } from "./context";
import { assertMfa, assertRole, requireActor } from "./policies";

export type HandlerAuth = "signed_in" | readonly AppRole[];

export interface Handler<I = unknown, O = unknown> {
  auth: HandlerAuth;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  run: (ctx: AppContext & { actor: Actor }, input: I) => Promise<O>;
}

/** A handler with its input/output types erased, for registries. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyHandler = Handler<any, any>;

export function defineHandler<I, O>(handler: Handler<I, O>): Handler<I, O> {
  return handler;
}

export async function dispatch(
  registry: Record<string, AnyHandler>,
  name: string,
  ctx: AppContext,
  rawInput: unknown,
): Promise<unknown> {
  const handler = Object.hasOwn(registry, name) ? registry[name] : undefined;
  if (!handler) throw new DomainError(404, "unknown_endpoint", "That endpoint does not exist.");

  const actor = requireActor(ctx.actor);
  if (handler.auth !== "signed_in") {
    assertRole(actor, handler.auth);
    if (handler.auth.some((r) => r === "technician" || r === "ops")) {
      assertMfa(actor, ctx.env.requireStaffMfa);
    }
  }

  const parsed = handler.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    throw new DomainError(400, "invalid_input", `${where}${issue?.message ?? "Invalid input."}`);
  }

  const result = await handler.run({ ...ctx, actor }, parsed.data);
  // Project the output: only declared fields leave the server (CLAUDE.md §2.5).
  return handler.output.parse(result);
}
