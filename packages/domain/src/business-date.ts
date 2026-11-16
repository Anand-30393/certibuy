// Business date: Asia/Kolkata calendar day + Settings.sim_day_offset (CLAUDE.md §2.3).
import type { IsoDate, Settings } from "./types";

const IST_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const MS_PER_DAY = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toUtcMidnight(date: IsoDate): number {
  if (!ISO_DATE.test(date)) throw new RangeError(`Not a yyyy-mm-dd date: ${date}`);
  return Date.parse(`${date}T00:00:00Z`);
}

/** Add whole days to a yyyy-mm-dd date. */
export function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(toUtcMidnight(date) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function diffDays(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcMidnight(to) - toUtcMidnight(from)) / MS_PER_DAY);
}

/** Calendar day of an instant in Asia/Kolkata. */
export function istDate(now: Date): IsoDate {
  return IST_DAY.format(now);
}

/** Today's business date. An explicit `override` (backfill / tests) is used verbatim. */
export function businessDate(
  now: Date,
  settings: Pick<Settings, "sim_day_offset">,
  override?: IsoDate,
): IsoDate {
  if (override !== undefined) {
    toUtcMidnight(override);
    return override;
  }
  return addDays(istDate(now), settings.sim_day_offset);
}
