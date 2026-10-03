// "Today" for every feature that needs it (streaks, the daily featured
// episode) is always the user's own local calendar date — never UTC,
// never Date.prototype.toISOString() (which is UTC and would silently
// misattribute sessions near local midnight for users outside UTC).
// See docs/superpowers/specs/2026-09-22-daily-engagement-design.md's
// "Timezone handling" section for the full reasoning.
export function getLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
