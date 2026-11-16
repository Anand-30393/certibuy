// Role resolution and guards (docs/roles.md.txt §3–§5). Used by route guards (UX) and by every
// command/view (authority). active_mode is never a permission.
import { AREA_ROLES, type AppRole, type Area } from "@certibuy/contracts";
import { AccessDenied, type Actor } from "./actor";

export function isStaff(actor: Actor): boolean {
  return actor.appRole === "technician" || actor.appRole === "ops" || actor.isPlatformAdmin;
}

/** Ops or platform admin: may see staff-wide projections. */
export function canSeeAll(actor: Actor): boolean {
  return actor.appRole === "ops" || actor.isPlatformAdmin;
}

/** Landing page for a role; a customer without a saved mode gets the one-time chooser. */
export function homeFor(actor: Actor): string {
  if (actor.appRole === "technician") return "/hub";
  if (actor.appRole === "ops") return "/ops";
  if (actor.activeMode === "seller") return "/seller";
  if (actor.activeMode === "buyer") return "/shop";
  return "/welcome";
}

/**
 * Route guard. Platform admins open any area; ops may preview any area while demo mode is on;
 * everyone else needs an allowed app_role.
 */
export function canOpenArea(actor: Actor, area: Area, opts: { demoMode: boolean }): boolean {
  if (actor.isPlatformAdmin) return true;
  if (actor.appRole === "ops" && opts.demoMode) return true;
  return AREA_ROLES[area].includes(actor.appRole);
}

/** Staff must have completed two-step verification when REQUIRE_STAFF_MFA is on. */
export function mfaSatisfied(actor: Actor, requireStaffMfa: boolean): boolean {
  return !requireStaffMfa || !isStaff(actor) || actor.aal === "aal2";
}

export function requireActor(actor: Actor | null): Actor {
  if (!actor) throw new AccessDenied(401, "signed_out", "Please sign in to continue.");
  return actor;
}

export function assertRole(actor: Actor, roles: readonly AppRole[]): void {
  if (actor.isPlatformAdmin || roles.includes(actor.appRole)) return;
  throw new AccessDenied(403, "wrong_role", "That action is for another role.");
}

export function assertMfa(actor: Actor, requireStaffMfa: boolean): void {
  if (!mfaSatisfied(actor, requireStaffMfa)) {
    throw new AccessDenied(403, "mfa_required", "Set up two-step verification to use staff tools.");
  }
}

/** Technicians are scoped to their hub; ops and platform admins may act on any hub. */
export function assertHubAccess(actor: Actor, hubId: string): void {
  if (canSeeAll(actor)) return;
  if (actor.appRole === "technician" && actor.hubId === hubId) return;
  throw new AccessDenied(403, "wrong_hub", "That job belongs to another hub.");
}

/** Owner check for customer records; staff-wide access is decided by the caller explicitly. */
export function assertOwner(actor: Actor, ownerId: string): void {
  if (actor.userId === ownerId || actor.isPlatformAdmin) return;
  throw new AccessDenied(403, "not_owner", "That record belongs to someone else.");
}
