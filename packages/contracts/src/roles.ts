// Roles and areas (docs/roles.md.txt). app_role is the permission axis; active_mode is a view preference.

export const APP_ROLES = ["customer", "technician", "ops"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const ACTIVE_MODES = ["buyer", "seller"] as const;
export type ActiveMode = (typeof ACTIVE_MODES)[number];

/** The signed-in areas of the app. `account` = profile and notifications (any signed-in user). */
export const AREAS = ["seller", "shop", "hub", "ops", "help", "account"] as const;
export type Area = (typeof AREAS)[number];

/** Which app_role may open each area (route guard + server check, roles.md.txt §4). */
export const AREA_ROLES: Record<Area, readonly AppRole[]> = {
  seller: ["customer"],
  shop: ["customer"],
  hub: ["technician", "ops"],
  ops: ["ops"],
  help: ["customer"],
  account: ["customer", "technician", "ops"],
};
