const SCALE = BigInt("1000000000000000000");
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
export function estimatedOrder(quantity: string, price: string, leverage: number) {
  if (!validQuantity(quantity) || !validLimitPrice(price) || !Number.isInteger(leverage) || leverage < 1 || leverage > 20) return null;
  const notional = decimalUnits(quantity) * decimalUnits(price) / SCALE;
  return { notional: unitsDecimal(notional), margin: unitsDecimal(notional / BigInt(leverage)) };
}
export function ratioQuantity(balance: string | null | undefined, price: string | null | undefined, leverage: number, percent: number) {
  if (!balance || !price || !validLimitPrice(price) || !Number.isInteger(leverage) || leverage < 1 || leverage > 20
    || ![25, 50, 75, 100].includes(percent)) return "";
  try { return unitsDecimal(decimalUnits(balance) * BigInt(leverage) * BigInt(percent) * BigInt(100_000_000) / (decimalUnits(price) * BigInt(100)), 8); }
  catch { return ""; }
}
