type Parts = { whole: string; fraction: string };
function parts(value: string | null | undefined): Parts | null {
  if (typeof value !== "string" || value.length > 120 || !/^\d+(\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return { whole: whole.replace(/^0+(?=\d)/, ""), fraction };
}
export function tickPrecision(tickSize?: string | null): number | null {
  const tick = parts(tickSize);
  if (!tick || !/[1-9]/.test(tick.whole + tick.fraction)) return null;
  const precision = tick.fraction.replace(/0+$/, "").length;
  return precision <= 30 ? precision : null;
}
export function marketPricePrecision(value?: string | null, tickSize?: string | null) {
  const metadata = tickPrecision(tickSize);
  if (metadata !== null) return metadata;
  const price = parts(value);
  if (!price || price.whole !== "0") return 2;
  const first = price.fraction.search(/[1-9]/);
  return first < 0 ? 2 : first < 2 ? 4 : first < 4 ? 6 : 8;
}
// String comparison is also used for display candles. Source decimals never pass through Number.
export function comparePrices(left: string, right: string) {
  const a = parts(left), b = parts(right);
  if (!a || !b) throw new Error("Invalid price decimal");
  if (a.whole.length !== b.whole.length) return a.whole.length > b.whole.length ? 1 : -1;
  if (a.whole !== b.whole) return a.whole > b.whole ? 1 : -1;
  const length = Math.max(a.fraction.length, b.fraction.length);
  const x = a.fraction.padEnd(length, "0"), y = b.fraction.padEnd(length, "0");
  return x === y ? 0 : x > y ? 1 : -1;
}
export function formatMarketPrice(value?: string | null, tickSize?: string | null) {
  const price = parts(value);
  if (!price) return "—";
  const precision = marketPricePrecision(value, tickSize);
  const digits = price.fraction.padEnd(precision, "0").slice(0, precision);
  if (price.whole === "0" && !/[1-9]/.test(digits) && /[1-9]/.test(price.fraction)) {
    return `<${precision ? `0.${"0".repeat(precision - 1)}1` : "1"}`;
  }
  let units = BigInt(price.whole + digits);
  if (price.fraction.charAt(precision) >= "5") units += BigInt(1);
  const rounded = units.toString().padStart(precision + 1, "0");
  const whole = precision ? rounded.slice(0, -precision) : rounded;
  const fraction = precision ? rounded.slice(-precision).replace(/0+$/, "") : "";
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction ? `.${fraction}` : "");
}
// Lightweight Charts requires doubles; conversion here is exclusively for its display boundary.
function chartDecimal(value: number) {
  if (!Number.isFinite(value) || value < 0) return undefined;
  const [mantissa, exponent] = String(value).toLowerCase().split("e");
  if (exponent === undefined) return mantissa;
  const [whole, fraction = ""] = mantissa.split(".");
  const digits = whole + fraction, offset = whole.length + Number(exponent);
  if (offset <= 0) return `0.${"0".repeat(-offset)}${digits}`;
  return offset >= digits.length ? digits.padEnd(offset, "0") : `${digits.slice(0, offset)}.${digits.slice(offset)}`;
}
export function marketChartPriceFormat(reference?: string | null, tickSize?: string | null) {
  return { type: "custom" as const, minMove: tickPrecision(tickSize) !== null ? Number(tickSize) : 10 ** -marketPricePrecision(reference, tickSize),
    formatter: (value: number) => formatMarketPrice(chartDecimal(value), tickSize) };
}
