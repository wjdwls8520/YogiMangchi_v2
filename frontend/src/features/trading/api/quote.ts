import { decimal, id, instant, invalidContract, record } from "./contracts";
import { decimalUnits } from "./order-input";
import type { GuestSession, SessionSnapshot } from "./guest-session";

export type QuoteRequest = { tradingSymbolId: number; type: "MARKET" | "LIMIT"; side: "LONG" | "SHORT"; quantity?: string; balancePercentage?: number; limitPrice?: string };
export function parseQuote(value: unknown, request: QuoteRequest) {
  const row = record(value);
  if (id(row.tradingSymbolId) !== request.tradingSymbolId || row.type !== request.type || row.side !== request.side) return invalidContract();
  if (id(row.leverage) > 100) return invalidContract();
  try {
    for(const name of ["quantity","referencePrice","notional","margin","feeRate","estimatedFee","totalRequired","availableBalance"] as const){
      const units=decimalUnits(decimal(row[name]));
      if((name==="quantity"||name==="referencePrice"||name==="notional"||name==="margin")&&units<=BigInt(0))return invalidContract();
    }
    if (request.quantity !== undefined && decimalUnits(decimal(row.quantity)) !== decimalUnits(request.quantity)) return invalidContract();
  } catch { return invalidContract(); }
  if (row.balancePercentage !== (request.balancePercentage ?? null)) return invalidContract();
  return { tradingSymbolId: request.tradingSymbolId, type: request.type, side: request.side, leverage: id(row.leverage),
    quantity: decimal(row.quantity), referencePrice: decimal(row.referencePrice), notional: decimal(row.notional), margin: decimal(row.margin),
    feeRate: decimal(row.feeRate), estimatedFee: decimal(row.estimatedFee), totalRequired: decimal(row.totalRequired), availableBalance: decimal(row.availableBalance),
    balancePercentage: row.balancePercentage as number | null, priceEventTime: instant(row.priceEventTime), quotedAt: instant(row.quotedAt) };
}
export function readQuote(session: GuestSession, identity: SessionSnapshot, request: QuoteRequest, signal: AbortSignal) {
  return session.read("account/orders/quote", identity, signal, request).then(value => parseQuote(value,request));
}
