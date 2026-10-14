import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTickers, visibleTicker } from "../src/features/trading/market/tickers";

const ticker = { tradingSymbolId: 927, symbol: "BTC", quoteAsset: "USDT", markPrice: "64000.000000000000000001", changePercent24h: "-2.370",
  highPrice24h: "65100.12", lowPrice24h: "62000.12", quoteVolume24h: "1234567890.000000000000000001", status: "FRESH", updatedAt: "2026-10-13T00:00:00Z" };
test("ticker contract keeps decimal strings, missing components and every active identity", () => {
  const data = parseTickers(Array.from({ length: 12 }, (_, i) => ({ ...ticker, tradingSymbolId: i + 1 })));
  assert.equal(data.length, 12); assert.equal(data[0].markPrice, ticker.markPrice); assert.equal(data[0].quoteVolume24h, ticker.quoteVolume24h);
  const partial = parseTickers([{ ...ticker, status: "UNAVAILABLE", markPrice: null }])[0];
  assert.equal(partial.markPrice, null); assert.equal(partial.changePercent24h, ticker.changePercent24h);
  assert.deepEqual(parseTickers([]), []);
});
test("invalid/duplicate ticker identities, decimal types and status fail closed", () => {
  for (const value of [{ data: [] }, [ticker, ticker], [{ ...ticker, markPrice: 64000 }], [{ ...ticker, status: "UNKNOWN" }], [{ ...ticker, updatedAt: "bad" }]]) assert.throws(() => parseTickers(value));
});
test("expired frontend ticker cache cannot show an old price as current", () => {
  const parsed = parseTickers([ticker])[0];
  assert.equal(visibleTicker(parsed, 5000), parsed); assert.equal(visibleTicker(parsed, 5001), undefined);
  assert.equal(visibleTicker(undefined, 0), undefined);
});
