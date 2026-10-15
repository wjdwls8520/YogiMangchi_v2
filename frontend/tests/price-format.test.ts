import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMarketPrice, marketChartPriceFormat, marketPricePrecision, tickPrecision } from "../src/features/trading/market/price-format";
import { formatDecimal } from "../src/features/trading/api/account";
import { parseSymbols } from "../src/features/trading/market/catalog";

test("adaptive market prices round display strings without losing source precision", () => {
  for (const [raw, display] of [["114230.12345678", "114,230.12"], ["125.500000", "125.5"], ["125", "125"],
    ["0.523456", "0.5235"], ["0.00834567", "0.008346"], ["0.000012345", "0.00001235"],
    ["999999999999999999.999999999999999999", "1,000,000,000,000,000,000"], ["0.999999", "1"], ["0", "0"]]) {
    const original = raw;
    assert.equal(formatMarketPrice(raw), display); assert.equal(raw, original);
  }
  assert.equal(formatDecimal("114230.12345678"), "114,230.12345678");
});
test("tiny nonzero prices remain visible instead of becoming zero", () => {
  for (const raw of ["0.000000001", "0.000000009", "0.000000000000000000001"]) assert.equal(formatMarketPrice(raw), "<0.00000001");
  assert.equal(formatMarketPrice("0.00000001"), "0.00000001");
  assert.equal(formatMarketPrice("0.0001", "0.01"), "<0.01");
});
test("valid tick metadata precedes adaptive precision and invalid metadata falls back", () => {
  for (const [tick, expected] of [["0.01", "0.12"], ["0.0001", "0.1235"], ["0.000001", "0.123457"], ["0.010000", "0.12"]]) assert.equal(formatMarketPrice("0.12345678", tick), expected);
  assert.equal(formatMarketPrice("125.5", "1"), "126");
  assert.equal(tickPrecision("0.25"), 2);
  for (const invalid of [undefined, null, "", "0", "-0.01", "1e-8", "NaN"]) assert.equal(formatMarketPrice("0.523456", invalid), "0.5235");
  assert.deepEqual(["100", "0.5", "0.005", "0.00005"].map(v=>marketPricePrecision(v)), [2,4,6,8]);
});
test("invalid, missing and negative market prices use the unavailable marker", () => {
  for (const value of [undefined, null, "", "NaN", "Infinity", "1e-8", "-1", "1,000", " 1.23 "]) assert.equal(formatMarketPrice(value), "—");
});
test("chart axis and crosshair share the price policy including scientific double notation", () => {
  assert.equal(marketChartPriceFormat("114230").formatter(114230.1234), "114,230.12");
  assert.equal(marketChartPriceFormat("0.00001234").minMove, 1e-8);
  assert.equal(marketChartPriceFormat("0.00001234").formatter(0.000012345), "0.00001235");
  assert.equal(marketChartPriceFormat("0.00000001").formatter(1e-10), "<0.00000001");
  assert.equal(marketChartPriceFormat("100", "0.0001").formatter(1.123456), "1.1235");
  assert.equal(marketChartPriceFormat("100", "0.25").minMove, 0.25);
  assert.equal(marketChartPriceFormat("100").formatter(NaN), "—");
});
test("optional symbol metadata is kept without inventing a tick for the current contract", () => {
  const symbol = {id:1,symbol:"TEST",name:"Test",quoteAsset:"USDT",displaySymbol:"TEST / USDT"};
  assert.equal(parseSymbols([symbol])[0].priceTickSize, undefined);
  assert.equal(parseSymbols([{...symbol,priceTickSize:"0.0001"}])[0].priceTickSize, "0.0001");
  assert.equal(parseSymbols([{...symbol,priceTickSize:0.01}])[0].priceTickSize, undefined);
});
