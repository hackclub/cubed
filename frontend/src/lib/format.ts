// "41h 24m" / "35m" / "<1m"; a project with no Hackatime time shows "0h 0m".
export function formatHackatimeTime(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "0h 0m";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return "<1m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Admin analytics helpers.
export function fmtHours(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const h = seconds / 3600;
  return `${h >= 100 ? Math.round(h) : Math.round(h * 10) / 10}h`;
}

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
