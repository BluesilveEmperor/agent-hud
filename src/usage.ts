// Shared helpers for rendering token usage. Kept here (not in types.ts) so
// both the pill and the expand panel can use the same formatting without
// duplicating logic.

import type { Usage } from "./types";

// 1234 -> "1.2k", 1234567 -> "1.2M". Keeps the pill compact.
export function fmtTokens(n?: number): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

// Context fill ratio in [0,1]. Returns null when we can't compute a meaningful
// bar (no limit, or limit <= 0).
export function contextRatio(u?: Usage): number | null {
  if (!u) return null;
  const ctx = u.contextTokens ?? 0;
  const limit = u.contextLimit ?? 0;
  if (!limit || limit <= 0) return null;
  return Math.max(0, Math.min(1, ctx / limit));
}

// Pick a colour for the context bar based on how full the window is.
// Green < 70%, amber < 90%, red at/above 90%.
export function contextColor(u?: Usage): string {
  const r = contextRatio(u);
  if (r == null) return "var(--c-idle)";
  if (r >= 0.9) return "var(--c-error)";
  if (r >= 0.7) return "#f5b042";
  return "var(--c-done)";
}

// Short label like "87k / 200k" for the bar, or "87k" when no limit.
export function contextLabel(u?: Usage): string {
  if (!u || u.contextTokens == null) return "";
  const ctx = fmtTokens(u.contextTokens);
  if (u.contextLimit && u.contextLimit > 0) return `${ctx} / ${fmtTokens(u.contextLimit)}`;
  return ctx;
}

// Percent string like "44%", or "" when no limit.
export function contextPercent(u?: Usage): string {
  const r = contextRatio(u);
  if (r == null) return "";
  return `${Math.round(r * 100)}%`;
}
