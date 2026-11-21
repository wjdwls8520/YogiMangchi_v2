import { decimal, id, instant, invalidContract, list, nullable, record } from "./contracts";
import { TradingApiError } from "./client";
import { validLimitPrice } from "./order-input";
import { parseOrder } from "./orders";

export function parseTakeProfit(value: unknown, positionId?: number, symbolId?: number, side?: string) {
  const row = record(value);
  if (
    !["NONE", "ACTIVE", "CANCELED", "TRIGGERED", "EXPIRED"].includes(String(row.status))
    || !["LONG", "SHORT"].includes(String(row.side))
    || !Number.isSafeInteger(row.version)
    || (row.version as number) < 0
  ) {
    return invalidContract();
  }
  const result = {
    positionId: id(row.positionId),
    tradingSymbolId: id(row.tradingSymbolId),
    side: row.side as "LONG" | "SHORT",
    status: row.status as "NONE" | "ACTIVE" | "CANCELED" | "TRIGGERED" | "EXPIRED",
    takeProfitPrice: nullable(row.takeProfitPrice, decimal),
    version: row.version as number,
    updatedAt: nullable(row.updatedAt, instant),
    triggeredAt: nullable(row.triggeredAt, instant),
    priceEventTime: nullable(row.priceEventTime, instant),
    triggerPrice: nullable(row.triggerPrice, decimal),
    triggerOrderId: nullable(row.triggerOrderId, id),
    reason: row.reason === null ? null : row.reason === "TAKE_PROFIT" ? ("TAKE_PROFIT" as const) : null,
  };
  if (
    (positionId !== undefined && result.positionId !== positionId)
    || (symbolId !== undefined && result.tradingSymbolId !== symbolId)
    || (side !== undefined && result.side !== side)
  ) {
    return invalidContract();
  }
  if (result.status === "NONE") {
    if (
      result.version !== 0
      || [
        row.takeProfitPrice,
        row.updatedAt,
        row.triggeredAt,
        row.priceEventTime,
        row.triggerPrice,
        row.triggerOrderId,
        row.reason,
      ].some((v) => v !== null)
    ) {
      return invalidContract();
    }
  } else if (
    result.version <= 0
    || !result.takeProfitPrice
    || !validLimitPrice(result.takeProfitPrice)
    || !result.updatedAt
  ) {
    return invalidContract();
  }
  if (
    result.status === "TRIGGERED"
    && (
      !result.triggeredAt
      || !result.priceEventTime
      || !result.triggerPrice
      || !validLimitPrice(result.triggerPrice)
      || !result.triggerOrderId
      || result.reason !== "TAKE_PROFIT"
    )
  ) {
    return invalidContract();
  }
  return result;
}

export type TakeProfit = ReturnType<typeof parseTakeProfit>;

export function latestTakeProfit(...values: (TakeProfit | undefined)[]) {
  return values.reduce<TakeProfit | undefined>(
    (latest, value) =>
      !value
      || (latest
        && (latest.positionId !== value.positionId
          || latest.tradingSymbolId !== value.tradingSymbolId
          || latest.side !== value.side
          || latest.version >= value.version))
        ? latest
        : value,
    undefined,
  );
}

export type TakeProfitCommand = {
  positionId: number;
  expectedVersion: number;
  takeProfitPrice?: string;
};

export function takeProfitRequest(command: TakeProfitCommand) {
  if (
    !Number.isSafeInteger(command.positionId)
    || command.positionId <= 0
    || !Number.isSafeInteger(command.expectedVersion)
    || command.expectedVersion < 0
    || (command.takeProfitPrice !== undefined && !validLimitPrice(command.takeProfitPrice))
  ) {
    throw new TradingApiError(400, undefined, "INVALID_TAKE_PROFIT");
  }
  const path = `account/positions/${command.positionId}/take-profit`;
  return command.takeProfitPrice === undefined
    ? { path: `${path}?expectedVersion=${command.expectedVersion}`, method: "DELETE" as const, body: undefined }
    : {
        path,
        method: "PUT" as const,
        body: { takeProfitPrice: command.takeProfitPrice, expectedVersion: command.expectedVersion },
      };
}

export function parseCancelAllOrdersResponse(value: unknown) {
  const row = record(value);
  if (typeof row.canceledCount !== "number" || !Number.isSafeInteger(row.canceledCount) || row.canceledCount < 0) {
    return invalidContract();
  }
  return {
    canceledCount: row.canceledCount,
    orders: list(row.orders, parseOrder),
  };
}

export function parseCloseAllPositionsResponse(value: unknown) {
  const row = record(value);
  if (typeof row.closedCount !== "number" || !Number.isSafeInteger(row.closedCount) || row.closedCount < 0) {
    return invalidContract();
  }
  return {
    closedCount: row.closedCount,
    orders: list(row.orders, parseOrder),
  };
}

export interface PortfolioVisibility {
  memberId: number;
  portfolioPublic: boolean;
  updatedAt: string | null;
}

export function parsePortfolioVisibility(value: unknown): PortfolioVisibility {
  const row = record(value);
  if (typeof row.portfolioPublic !== "boolean") {
    return invalidContract();
  }
  return {
    memberId: id(row.memberId),
    portfolioPublic: row.portfolioPublic,
    updatedAt: nullable(row.updatedAt, instant),
  };
}
