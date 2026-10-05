/**
 * The one RAG status color set (ledger m4). Entity-identity colors live in
 * catalogs/constants per brand rules, retuned to the quiet register
 * (L 0.60–0.78, C ≤ 0.09 — docs/platform/brand.md §3). Consumed by RagChip,
 * and later by gate/issue/schedule/exposure chips — never re-declared locally.
 */
export type RagTone = "green" | "amber" | "red" | "neutral";

export const RAG_COLORS: Record<RagTone, string> = {
  green: "oklch(0.68 0.08 150)",
  amber: "oklch(0.75 0.09 75)",
  red: "oklch(0.64 0.09 25)",
  neutral: "oklch(0.70 0.02 60)",
};

/** 12% tint for chip backgrounds (matches the existing HealthChip treatment). */
export function ragBackground(tone: RagTone): string {
  return `color-mix(in oklab, ${RAG_COLORS[tone]} 14%, transparent)`;
}
