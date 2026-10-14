import { test } from "node:test";
import assert from "node:assert/strict";
import { freshMarkPrice, selectedMarket, type SelectedMarket } from "../src/features/trading/market/selected-market";

const feed: SelectedMarket = { symbolId: 927, state: "READY", price: { eventTime: 1000, decimal: "64000.000000000000000001", value: 64000 } };
test("chart/header/form share decimal mark price only for the selected fresh stream", () => {
  assert.equal(freshMarkPrice(selectedMarket(feed, 927))?.decimal, feed.price?.decimal);
  assert.equal(freshMarkPrice(selectedMarket(feed, 42)), null);
  assert.equal(freshMarkPrice(selectedMarket(feed, null)), null);
  for (const state of ["CONNECTING", "WAITING_FOR_FIRST_PRICE", "RECONNECTING", "UNAVAILABLE"] as const) {
    assert.equal(freshMarkPrice({ ...feed, state }), null);
  }
  assert.equal(selectedMarket(feed, 42).price, null);
  assert.equal(selectedMarket(feed, 927).price, feed.price);
});
