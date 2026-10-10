export type PortfolioPosition = { symbol: string; margin: string };
const SCALE = BigInt("1000000000000000000");
export const ALLOCATION_COLORS = ["#4f46e5", "#475569", "#0f766e", "#a16207", "#7c3aed"];

function units(decimal: string) {
  if (!/^\d{1,30}(\.\d{1,18})?$/.test(decimal)) throw new Error("Invalid margin");
  const [whole, fraction = ""] = decimal.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(18, "0"));
}
function decimal(value: bigint) {
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(18, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}
export function formatMargin(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.padEnd(2, "0")} USDT`;
}
export function portfolioAllocation(positions: readonly PortfolioPosition[]) {
  const sums = new Map<string, bigint>();
  try {
    for (const position of positions) {
      if (!position.symbol.trim()) throw new Error("Missing symbol");
      sums.set(position.symbol, (sums.get(position.symbol) ?? BigInt(0)) + units(position.margin));
    }
  } catch { return { view: "unavailable" as const, entries: [] }; }
  const total = [...sums.values()].reduce((sum, value) => sum + value, BigInt(0));
  if (total === BigInt(0)) return { view: "empty" as const, entries: [] };
  // Exact decimal aggregation; number conversion is confined to the visual
  // proportion, never the margin or any authoritative trading calculation.
  const entries = [...sums].filter(([, value]) => value > BigInt(0)).map(([symbol, value], index) => ({
    symbol, margin: decimal(value), percent: Number(value * BigInt(100_000_000) / total) / 1_000_000,
    color: ALLOCATION_COLORS[index % ALLOCATION_COLORS.length],
  }));
  return { view: "data" as const, entries };
}
