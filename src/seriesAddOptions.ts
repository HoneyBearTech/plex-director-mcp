// The series types and monitor options a series can be added to Sonarr with.
// One definition, used by confirm_selected_series (src/tools/seriesAdd.ts) and
// by the settings API, which refuses a saved default outside these lists.

export const SERIES_TYPES = ["standard", "daily", "anime"] as const;
export type SeriesType = (typeof SERIES_TYPES)[number];

// The values of Sonarr's MonitorTypes this tool offers (its API schema lists
// more, such as latestSeason and recent).
export const MONITOR_OPTIONS = [
  "all",
  "future",
  "missing",
  "existing",
  "firstSeason",
  "lastSeason",
  "pilot",
  "none",
] as const;
export type MonitorOption = (typeof MONITOR_OPTIONS)[number];

// The allowed value that matches, ignoring case, or undefined.
export function matchOption<T extends string>(allowed: readonly T[], value: string): T | undefined {
  return allowed.find((a) => a.toLowerCase() === value.toLowerCase());
}
