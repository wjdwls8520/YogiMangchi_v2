import { test } from "node:test";
import assert from "node:assert/strict";
import { marketEndpoints, parseSymbols } from "../src/features/trading/market/catalog";
import { PriceHistory, MAX_PRICE_POINTS } from "../src/features/trading/market/history";
import { portfolioAllocation, formatMargin } from "../src/features/trading/portfolio/allocation";
import { previewPositions } from "../src/features/trading/preview-data";

test("catalog uses actual safe server IDs and HTTP/WS origins", () => {
  assert.equal(parseSymbols([{ id: 927, symbol: "BTC", name: "Bitcoin", quoteAsset: "USDT", displaySymbol: "BTC / USDT" }])[0].id, 927);
  assert.throws(() => parseSymbols([{ id: Number.MAX_SAFE_INTEGER + 1 }]));
  assert.throws(() => parseSymbols({ data: [] }));
  assert.deepEqual(marketEndpoints("https://trade.example.com"), { symbols: "https://trade.example.com/api/v1/symbols", socket: "wss://trade.example.com/ws/market" });
  assert.throws(() => marketEndpoints("https://user:secret@example.com"));
  assert.throws(() => marketEndpoints("https://example.com/other"));
});
test("same-second ticks replace; duplicate and reverse events never change history", () => {
  const history = new PriceHistory();
  history.append(1001, 10);
  const second = history.append(1999, 12)!;
  assert.deepEqual(second.points, [{ time: 1, value: 12 }]);
  assert.equal(history.append(1999, 30), null);
  assert.equal(history.append(1000, 30), null);
  assert.equal(history.append(2000, Infinity), null);
  assert.deepEqual(history.append(2000, 20)!.points, [{ time: 1, value: 12 }, { time: 2, value: 20 }]);
});
test("long sessions bound library data too, with occasional batch pruning", () => {
  const history = new PriceHistory();
  let prunes = 0;
  for (let index = 0; index < 25_000; index++) {
    const update = history.append(index * 1000, 100 + index)!;
    assert.ok(update.points.length <= MAX_PRICE_POINTS);
    assert.equal(update.points.at(-1)?.time, index);
    if (update.pruned) { prunes++; assert.equal(update.points.length, 1500); }
  }
  assert.ok(prunes > 0 && prunes < 100);
});
test("portfolio shares position source and weights margin, combining same-symbol lots", () => {
  const preview = portfolioAllocation(previewPositions);
  assert.equal(preview.view, "data");
  assert.equal(preview.entries[0].percent.toFixed(1), "75.7");
  assert.equal(preview.entries[1].percent.toFixed(1), "24.3");
  const result = portfolioAllocation([{ symbol: "BTC", margin: "0.1" }, { symbol: "ETH", margin: "0.3" }, { symbol: "BTC", margin: "0.2" }]);
  assert.deepEqual(result.entries.map((entry) => [entry.symbol, entry.margin, entry.percent]), [["BTC", "0.3", 50], ["ETH", "0.3", 50]]);
  assert.equal(formatMargin("1600"), "1,600.00 USDT");
});
test("decimal precision is preserved; missing, zero and invalid margins are safe", () => {
  const result = portfolioAllocation([{ symbol: "BTC", margin: "999999999999999999.000000000000000001" }, { symbol: "BTC", margin: "0.000000000000000001" }]);
  assert.equal(result.entries[0].margin, "999999999999999999.000000000000000002");
  assert.equal(portfolioAllocation([]).view, "empty");
  assert.equal(portfolioAllocation([{ symbol: "BTC", margin: "0" }]).view, "empty");
  for (const margin of ["-1", "NaN", "1,000.00 USDT", "1e5"]) assert.equal(portfolioAllocation([{ symbol: "BTC", margin }]).view, "unavailable");
});
