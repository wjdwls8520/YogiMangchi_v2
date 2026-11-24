import { id, instant, invalidContract, nullable, record } from "./contracts";
import { marginMode, transitionStatus } from "./margin";
import { SERVER_MAX_LEVERAGE } from "./order-input";

export function validLeverage(value: number, max = SERVER_MAX_LEVERAGE) {
  return Number.isInteger(value) && value >= 1 && value <= max;
}
export function leveragePath(symbolId: number, side: "LONG" | "SHORT" = "LONG"): `account/symbols/${number}/leverage?side=${"LONG" | "SHORT"}` {
  id(symbolId);
  return `account/symbols/${symbolId}/leverage?side=${side}`;
}
export function parseLeverage(value: unknown, symbolId: number, side: "LONG" | "SHORT" = "LONG") {
  const row = record(value), leverage = id(row.leverage), maxLeverage = id(row.maxLeverage);
  if (row.side !== side || id(row.tradingSymbolId) !== symbolId || maxLeverage > SERVER_MAX_LEVERAGE
    || !validLeverage(leverage, maxLeverage)) return invalidContract();
  return { tradingSymbolId: symbolId, side, leverage, maxLeverage, marginMode: marginMode(row.marginMode), marginTransitionStatus: transitionStatus(row.marginTransitionStatus), updatedAt: nullable(row.updatedAt, instant) };
}
