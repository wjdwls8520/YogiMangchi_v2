const SCALE = BigInt("1000000000000000000");
export const MAX_INPUT_LEVERAGE = 100;
// Runtime OpenAPI, TradingMath and DB constraints currently cap actual orders at 20.
export const SERVER_MAX_LEVERAGE = 20;
export function decimalUnits(value: string) {
  if (!/^\d{1,30}(\.\d{1,18})?$/.test(value)) throw new Error("Invalid decimal");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(18, "0"));
}
export function unitsDecimal(value: bigint, scale = 18) {
  const factor = BigInt(10) ** BigInt(scale);
  const fraction = (value % factor).toString().padStart(scale, "0").replace(/0+$/, "");
  return `${value / factor}${fraction ? `.${fraction}` : ""}`;
}
export function validQuantity(value: string) {
  return /^\d{1,13}(\.\d{1,8})?$/.test(value) && decimalUnits(value) > BigInt(0) && decimalUnits(value) <= BigInt("1000000000000") * SCALE;
}
export function validLimitPrice(value: string) {
  return /^\d{1,20}(\.\d{1,18})?$/.test(value) && decimalUnits(value) > BigInt(0);
}
// Display/input helpers only. The server still validates margin and executes at its price.
export function validSizingPrice(value: string) {
  return /^\d{1,40}(\.\d{1,30})?$/.test(value) && /[1-9]/.test(value);
}
function priceFraction(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return { units: BigInt(whole + fraction), scale: BigInt(10) ** BigInt(fraction.length) };
}
export function estimatedOrder(quantity: string, price: string, leverage: number) {
  if (!validQuantity(quantity) || !validSizingPrice(price) || !Number.isInteger(leverage) || leverage < 1 || leverage > MAX_INPUT_LEVERAGE) return null;
  const parsed = priceFraction(price), product = decimalUnits(quantity) * parsed.units;
  const denominator = parsed.scale * BigInt(leverage);
  // Match TradingMath.margin's positive CEILING at scale 18; never understate required margin.
  return { notional: unitsDecimal(product / parsed.scale), margin: unitsDecimal((product + denominator - BigInt(1)) / denominator) };
}
export function ratioQuantity(balance: string | null | undefined, price: string | null | undefined, leverage: number, percent: number) {
  if (!balance || !price || !validSizingPrice(price) || !Number.isInteger(leverage) || leverage < 1 || leverage > MAX_INPUT_LEVERAGE
    || !Number.isInteger(percent) || percent < 1 || percent > 100) return "";
  try {
    const parsed = priceFraction(price);
    const quantity = unitsDecimal(decimalUnits(balance) * BigInt(leverage) * BigInt(percent) * parsed.scale * BigInt(100_000_000) / (SCALE * parsed.units * BigInt(100)), 8);
    return validQuantity(quantity) ? quantity : "";
  }
  catch { return ""; }
}
