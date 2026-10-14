import { decimal, id, instant, invalidContract, list, nullable, record, text } from "../api/contracts";

export function parseTickers(value: unknown) {
  const ids = new Set<number>();
  return list(value, (value) => {
    const row = record(value);
    const tradingSymbolId = id(row.tradingSymbolId);
    if (ids.has(tradingSymbolId) || !["FRESH", "STALE", "UNAVAILABLE"].includes(text(row.status))) return invalidContract();
    ids.add(tradingSymbolId);
    return { tradingSymbolId, symbol: text(row.symbol), quoteAsset: text(row.quoteAsset),
      markPrice: nullable(row.markPrice, decimal), changePercent24h: nullable(row.changePercent24h, decimal),
      highPrice24h: nullable(row.highPrice24h, decimal), lowPrice24h: nullable(row.lowPrice24h, decimal),
      quoteVolume24h: nullable(row.quoteVolume24h, decimal), status: text(row.status), updatedAt: nullable(row.updatedAt, instant) };
  });
}
export type MarketTicker = ReturnType<typeof parseTickers>[number];
export function visibleTicker(ticker: MarketTicker | undefined, age: number): MarketTicker | undefined {
  // The API already nulls stale components. Do not keep showing a cached quote as current.
  return age <= 5000 ? ticker : undefined;
}
