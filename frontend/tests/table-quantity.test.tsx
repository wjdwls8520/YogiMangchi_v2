import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { compactQuantity, TableQuantity } from "../src/features/trading/components/table-quantity";

test("table quantity compresses decimals without floating point or zeroing small holdings", () => {
  assert.equal(compactQuantity("0.02762505"), "0.028");
  assert.equal(compactQuantity("3.02762505"), "3.028");
  assert.equal(compactQuantity("0.00012500"), "0.000125");
  assert.equal(compactQuantity("0.00000001"), "0.00000001");
  assert.equal(compactQuantity("0.0000000000001"), "<0.000000000001");
  assert.equal(compactQuantity("99999999999999999999.9999"), "100,000,000,000,000,000,000");
  assert.equal(compactQuantity("0.00000000"), "0");
  assert.equal(compactQuantity("123.12345678", "0.05"), "123.12345678");
  assert.equal(compactQuantity("123.123456789012", "0.0000005"), "123.123456789012");
  assert.equal(compactQuantity("0.02762505", "77000"), "0.028");
});

test("table exact quantity is accessible on desktop and touch without changing its source", () => {
  const raw = "3.02762505";
  const html = renderToStaticMarkup(<TableQuantity value={raw} unit="BTC" />);
  assert.match(html, /<details/);
  assert.match(html, /<summary title="3.02762505 BTC"/);
  assert.match(html, /정확한 수량: 3.02762505/);
  assert.match(html, /3.028/);
  assert.equal(raw, "3.02762505");
});
