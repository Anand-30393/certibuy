import type { PrismaClient } from "@certibuy/db";
import { DomainError, type Settings } from "@certibuy/domain";

/** Read the single Settings record. Missing Settings is a hard stop, never defaulted. */
export async function loadSettings(db: PrismaClient): Promise<Settings> {
  const row = await db.settings.findUnique({ where: { id: 1 } });
  if (!row) throw new DomainError(400, "settings_missing", "Settings are missing.");
  const { id, settings_version, updated_date, ...settings } = row;
  void id;
  void settings_version;
  void updated_date;
  return settings;
}
