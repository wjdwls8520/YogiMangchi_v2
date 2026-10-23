import { decimal, id, instant, invalidContract, nullable, record, text } from "./contracts";
import { parseSummary } from "./account";

function flag(value: unknown) { return typeof value === "boolean" ? value : invalidContract(); }
function count(value: unknown) { return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : invalidContract(); }
function oneOf<T extends string>(value: unknown, values: readonly T[]): T { return values.includes(value as T) ? value as T : invalidContract(); }
export function parseRound(value: unknown) {
  const row = record(value), status = oneOf(row.status, ["ACTIVE", "COMPLETED"] as const), currentRound = flag(row.currentRound);
  const funding = oneOf(row.funding, ["INITIAL_GRANT", "MEMBER_RESTART", "LEGACY_UNVERIFIED"] as const);
  const endedAt = nullable(row.endedAt, instant), endReason = nullable(row.endReason, text), initialBalance = nullable(row.initialBalance, decimal);
  const rawWallet = row.finalWallet === null ? null : record(row.finalWallet);
  const finalWallet = rawWallet === null ? null : Object.fromEntries(["balance", "usedMargin", "reservedMargin", "realizedPnl", "feesPaid", "settlementAdjustment"].map(key => [key, decimal(rawWallet[key])]));
  if (currentRound !== (status === "ACTIVE") || currentRound && (endedAt !== null || endReason !== null || finalWallet !== null)
    || !currentRound && (endedAt === null || endReason === null || finalWallet === null) || (funding === "LEGACY_UNVERIFIED") !== (initialBalance === null)) return invalidContract();
  return { roundId: id(row.roundId), roundNumber: id(row.roundNumber), status, funding, initialBalance, startedAt: instant(row.startedAt), endedAt, endReason, finalWallet, currentRound };
}
export function parseRoundSummary(value: unknown, accountId: number, expectedRound?: number) {
  const row = record(value), round = parseRound(row.round);
  if (expectedRound !== undefined && round.roundId !== expectedRound || round.currentRound !== (row.currentAccount !== null)) return invalidContract();
  return { round, currentAccount: row.currentAccount === null ? null : parseSummary(row.currentAccount, accountId), restartAvailable: flag(row.restartAvailable),
    nextAvailableAt: nullable(row.nextAvailableAt, instant), realizedPnl: decimal(row.realizedPnl), feesPaid: decimal(row.feesPaid), settlementAdjustment: decimal(row.settlementAdjustment) };
}
export type RoundSummary = ReturnType<typeof parseRoundSummary>;
export function parseRestart(value: unknown) {
  const row = record(value);
  return { roundId: id(row.roundId), roundNumber: id(row.roundNumber), balance: decimal(row.balance), restartedAt: instant(row.restartedAt), nextAvailableAt: instant(row.nextAvailableAt), canceledOrderCount: count(row.canceledOrderCount), closedPositionCount: count(row.closedPositionCount) };
}
export type RoundLedgerKind = "orders" | "fills" | "positions";
export type RoundLedgerRow = Record<string, string | number | null>;
export function parseRoundLedger(value: unknown, kind: RoundLedgerKind, roundId: number, cursor?: number) {
  const parse = (value: unknown): RoundLedgerRow => {
    const row = record(value), item: RoundLedgerRow = { id: id(row.id), roundId: id(row.roundId) };
    if (item.roundId !== roundId) return invalidContract();
    const fields = kind === "fills" ? ["price", "quantity", "realizedPnl", "fee", "settlementAdjustment"]
      : kind === "orders" ? ["quantity"] : ["quantity", "initialQuantity", "entryPrice", "realizedPnl", "margin"];
    fields.forEach(key => { item[key] = decimal(row[key]); });
    if (kind === "fills") { item.orderId = id(row.orderId); item.executedAt = instant(row.executedAt); }
    else {
      item.tradingSymbolId = id(row.tradingSymbolId); item.side = oneOf(row.side, ["LONG", "SHORT"]);
      item.leverage = id(row.leverage); if (item.leverage > 100) return invalidContract();
      if (kind === "orders") {
        item.type = oneOf(row.type, ["MARKET", "LIMIT"]); item.action = oneOf(row.action, ["OPEN", "CLOSE", "LIQUIDATE"]);
        item.status = oneOf(row.status, ["PENDING", "FILLED", "CANCELED", "REJECTED"]); item.positionId = nullable(row.positionId, id);
        item.filledPrice = nullable(row.filledPrice, decimal); item.limitPrice = nullable(row.limitPrice, decimal); item.createdAt = instant(row.createdAt); item.completedAt = nullable(row.completedAt, instant); item.reason = nullable(row.reason, text);
      } else {
        item.status = oneOf(row.status, ["OPEN", "CLOSED", "LIQUIDATED"]); item.exitPrice = nullable(row.exitPrice, decimal);
        item.openedAt = instant(row.openedAt); item.closedAt = nullable(row.closedAt, instant); item.closeReason = nullable(row.closeReason, text);
        for (const key of ["retiredQuantity", "retiredEntryNotional", "retiredMargin"]) item[key] = nullable(row[key], decimal);
      }
    }
    return item;
  };
  return roundPage(value, parse, item => item.id as number, cursor);
}
export function roundPage<T>(value: unknown, parse: (value: unknown) => T, getId: (item: T) => number, cursor?: number) {
  const row = record(value);
  if (!Array.isArray(row.content) || row.content.length > 100) return invalidContract();
  const content = row.content.map(parse), nextCursorId = nullable(row.nextCursorId, id);
  const ids = content.map(getId);
  if (new Set(ids).size !== ids.length || ids.some((value, index) => value >= (index ? ids[index - 1] : cursor ?? Infinity))
    || nextCursorId !== null && (nextCursorId !== ids.at(-1) || !ids.length)) return invalidContract();
  return { content, nextCursorId };
}
