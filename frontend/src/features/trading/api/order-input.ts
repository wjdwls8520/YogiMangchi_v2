import { marketPricePrecision } from "../market/price-format";

const SCALE = BigInt("1000000000000000000");
const QTY_SCALE = BigInt("100000000");
const MAX_QTY_STEPS = BigInt("1000000000000") * QTY_SCALE;
const MAX_OPEN_NOTIONAL = BigInt("1000000");
export const MAX_INPUT_LEVERAGE = 100;
// Runtime OpenAPI: shared symbol leverage, integer 1–100.
export const SERVER_MAX_LEVERAGE = 100;
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
// TradingMath.MIN_ORDER_NOTIONAL applies only to new OPEN orders.
export const MIN_OPEN_NOTIONAL = "10";
export function belowMinimumOpenNotional(quantity: string, price: string) {
  if (!validQuantity(quantity) || !validSizingPrice(price)) return false;
  const parsed = priceFraction(price);
  return decimalUnits(quantity) * parsed.units < decimalUnits(MIN_OPEN_NOTIONAL) * parsed.scale;
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
export function estimatedOrderWithFee(quantity: string, price: string, leverage: number, type: "MARKET" | "LIMIT") {
  const base = estimatedOrder(quantity, price, leverage);
  if (!base) return null;
  const parsed = priceFraction(price), product = decimalUnits(quantity) * parsed.units;
  const rateBps = type === "MARKET" ? BigInt(5) : BigInt(3);
  const feeDen = parsed.scale * BigInt(10_000);
  const feeUnits = (product * rateBps + feeDen - BigInt(1)) / feeDen;
  const marginUnits = decimalUnits(base.margin);
  return {
    notional: base.notional,
    margin: base.margin,
    feeRate: type === "MARKET" ? "0.0005" : "0.0003",
    estimatedFee: unitsDecimal(feeUnits),
    totalRequired: unitsDecimal(marginUnits + feeUnits),
  };
}
export function feeInclusiveRatioQuantity(
  balance: string | null | undefined,
  price: string | null | undefined,
  leverage: number,
  percent: number,
  type: "MARKET" | "LIMIT",
) {
  if (!balance || !price || !validSizingPrice(price) || !Number.isInteger(leverage) || leverage < 1 || leverage > MAX_INPUT_LEVERAGE
    || !Number.isInteger(percent) || percent < 1 || percent > 100) return "0";
  try {
    const availableUnits = decimalUnits(balance);
    if (availableUnits <= BigInt(0)) return "0";
    const budgetUnits = (availableUnits * BigInt(percent)) / BigInt(100);
    if (budgetUnits <= BigInt(0)) return "0";
    const parsed = priceFraction(price);
    if (parsed.units <= BigInt(0)) return "0";
    const maxByNotional = (MAX_OPEN_NOTIONAL * parsed.scale * QTY_SCALE) / parsed.units;
    const highBound = maxByNotional < MAX_QTY_STEPS ? maxByNotional : MAX_QTY_STEPS;
    if (highBound < BigInt(1)) return "0";
    const rateBps = type === "MARKET" ? BigInt(5) : BigInt(3);
    const denMargin = parsed.scale * QTY_SCALE * BigInt(leverage);
    const denFee = parsed.scale * QTY_SCALE * BigInt(10_000);
    const costAt = (qtySteps: bigint) => {
      const marginUnits = (parsed.units * qtySteps * SCALE + denMargin - BigInt(1)) / denMargin;
      const feeUnits = (parsed.units * qtySteps * rateBps * SCALE + denFee - BigInt(1)) / denFee;
      return marginUnits + feeUnits;
    };
    if (costAt(BigInt(1)) > budgetUnits) return "0";
    let low = BigInt(1), high = highBound, best = BigInt(1);
    while (low <= high) {
      const mid = (low + high) >> BigInt(1);
      if (costAt(mid) <= budgetUnits) {
        best = mid;
        low = mid + BigInt(1);
      } else {
        high = mid - BigInt(1);
      }
    }
    const result = unitsDecimal(best, 8);
    return validQuantity(result) ? result : "0";
  } catch {
    return "0";
  }
}
export function formatEditableDecimal(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  if (!trimmed.includes(".")) return trimmed;
  return trimmed.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}
export function suggestPassiveLimitPrice(
  markPrice: string | null | undefined,
  side: "LONG" | "SHORT",
  tickSize?: string | null,
  close = false,
): string | null {
  if (!markPrice || !validSizingPrice(markPrice)) return null;
  try {
    const [whole, rawFraction = ""] = markPrice.split(".");
    const truncatedFraction = rawFraction.slice(0, 18).padEnd(18, "0");
    const hasSub18Remainder = /[1-9]/.test(rawFraction.slice(18));
    const markFloor18 = BigInt(whole) * SCALE + BigInt(truncatedFraction);
    let stepUnits = BigInt(0);
    if (tickSize && validLimitPrice(tickSize)) {
      stepUnits = decimalUnits(tickSize);
    }
    if (stepUnits <= BigInt(0)) {
      const precision = Math.min(18, Math.max(0, marketPricePrecision(markPrice, tickSize)));
      stepUnits = BigInt(10) ** BigInt(18 - precision);
    }
    const mustBeBelowMark = (side === "LONG") !== close;
    let candidate: bigint;
    if (mustBeBelowMark) {
      if (hasSub18Remainder) {
        candidate = (markFloor18 / stepUnits) * stepUnits;
      } else {
        candidate = markFloor18 > BigInt(1) ? ((markFloor18 - BigInt(1)) / stepUnits) * stepUnits : BigInt(0);
      }
      if (candidate <= BigInt(0) && markFloor18 > BigInt(1)) {
        candidate = markFloor18 - BigInt(1);
      }
    } else {
      candidate = (markFloor18 / stepUnits + BigInt(1)) * stepUnits;
    }
    if (candidate <= BigInt(0)) return null;
    const formatted = unitsDecimal(candidate, 18);
    return validLimitPrice(formatted) ? formatted : null;
  } catch {
    return null;
  }
}

export function stepDecimalPrice(
  currentPrice: string,
  fallbackPrice: string | null | undefined,
  tickSize: string | null | undefined,
  delta: 1 | -1,
): string | null {
  try {
    const trimmed = currentPrice.trim();
    const seed = validLimitPrice(trimmed)
      ? trimmed
      : fallbackPrice && validSizingPrice(fallbackPrice)
        ? formatEditableDecimal(fallbackPrice)
        : "";
    if (!seed || !validLimitPrice(seed)) return null;
    const baseUnits = decimalUnits(seed);
    let stepUnits = BigInt(0);
    if (tickSize && validLimitPrice(tickSize)) {
      stepUnits = decimalUnits(tickSize);
    }
    if (stepUnits <= BigInt(0)) {
      const precision = Math.min(18, Math.max(0, marketPricePrecision(seed, tickSize)));
      stepUnits = BigInt(10) ** BigInt(18 - precision);
    }
    const nextUnits = baseUnits + BigInt(delta) * stepUnits;
    if (nextUnits <= BigInt(0)) return seed;
    const formatted = unitsDecimal(nextUnits, 18);
    return validLimitPrice(formatted) ? formatted : seed;
  } catch {
    return null;
  }
}
