import { id, instant, invalidContract, nullable, record } from "./contracts";
import { SERVER_MAX_LEVERAGE } from "./order-input";

export function validLeverage(value: number, max = SERVER_MAX_LEVERAGE) {
  return Number.isInteger(value) && value >= 1 && value <= max;
}
export function leveragePath(symbolId: number): `account/symbols/${number}/leverage` {
  id(symbolId);
  return `account/symbols/${symbolId}/leverage`;
}
export function parseLeverage(value: unknown, symbolId: number) {
  const row = record(value), leverage = id(row.leverage), maxLeverage = id(row.maxLeverage);
  if (id(row.tradingSymbolId) !== symbolId || maxLeverage > SERVER_MAX_LEVERAGE
    || !validLeverage(leverage, maxLeverage) || row.marginMode !== "CROSS") return invalidContract();
  return { tradingSymbolId: symbolId, leverage, maxLeverage, marginMode: "CROSS" as const, updatedAt: nullable(row.updatedAt, instant) };
}
