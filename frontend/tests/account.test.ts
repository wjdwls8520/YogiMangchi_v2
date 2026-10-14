import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDecimal, parsePosition, parseSummary, portfolioPositions } from "../src/features/trading/api/account";
import { portfolioAllocation } from "../src/features/trading/portfolio/allocation";

export const positionFixture = {
  id: 17, tradingSymbolId: 927, side: "LONG", quantity: "0.25000000", reservedCloseQuantity: "0.00000000", freeCloseQuantity: "0.25000000",
  entryPrice: "64000.000000000000000001", leverage: 10, margin: "1600.000000000000000001", status: "OPEN",
  realizedPnl: "0.00", markPrice: "64579.8", unrealizedPnl: "144.95", priceStatus: "FRESH",
  priceEventTime: "2026-10-13T00:00:00Z", openedAt: "2026-10-12T00:00:00Z",
};
const wallet = { quoteAsset: "USDT", balance: "10000", usedMargin: "1600", reservedMargin: "0", realizedPnl: "0", unrealizedPnl: "144.95", equity: "10144.95", availableBalance: "8544.95", valuationStatus: "FRESH" };
const summary = { accountId: 3, status: "ACTIVE", createdAt: "2026-10-12T00:00:00Z", valuedAt: "2026-10-13T00:00:00Z", wallet, positions: [positionFixture] };

test("real summary preserves decimal strings, empty positions and unavailable valuation", () => {
  assert.equal(parseSummary(summary, 3).positions[0].entryPrice, positionFixture.entryPrice);
  assert.deepEqual(parseSummary({ ...summary, positions: [] }, 3).positions, []);
  const unavailable = parseSummary({ ...summary, wallet: { ...wallet, equity: null, unrealizedPnl: null, availableBalance: null, valuationStatus: "UNAVAILABLE" }, positions: [{ ...positionFixture, markPrice: null, unrealizedPnl: null, priceEventTime: null, priceStatus: "MISSING" }] }, 3);
  assert.equal(unavailable.wallet.equity, null);
  assert.equal(unavailable.positions[0].markPrice, null);
  assert.equal(formatDecimal(null), "—");
});
test("invalid account DTOs and mismatched identity are rejected", () => {
  assert.throws(() => parseSummary(summary, 4));
  for (const value of [{ ...summary, positions: {} }, { ...summary, wallet: { ...wallet, equity: 10000 } }, { ...summary, valuedAt: "not a date" }]) assert.throws(() => parseSummary(value, 3));
  for (const value of [{ ...positionFixture, margin: 1 }, { ...positionFixture, side: "BUY" }, { ...positionFixture, quantity: "1e-8" }, { ...positionFixture, markPrice: undefined }]) assert.throws(() => parsePosition(value));
});
test("real positions map by server symbol ID with precision and honest missing-catalog labels", () => {
  const positions = [parsePosition({ ...positionFixture, margin: "999999999999999999.000000000000000001" }), parsePosition({ ...positionFixture, id: 18, margin: "0.000000000000000001" })];
  const mapped = portfolioPositions(positions, [{ id: 927, symbol: "BTC", displaySymbol: "BTC / USDT", name: "Bitcoin", quoteAsset: "USDT" }]);
  const allocation = portfolioAllocation(mapped);
  assert.equal(allocation.entries[0].symbol, "BTC / USDT");
  assert.equal(allocation.entries[0].margin, "999999999999999999.000000000000000002");
  assert.equal(portfolioPositions(positions, [])[0].symbol, "종목 #927");
  assert.equal(formatDecimal(positionFixture.entryPrice), "64,000.000000000000000001");
  assert.equal(formatDecimal("-144.950000000000000000"), "-144.95");
});
