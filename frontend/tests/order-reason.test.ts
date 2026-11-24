import { test } from "node:test";
import assert from "node:assert/strict";
import { orderReason } from "../src/features/trading/api/order-reason";
test("current and historical order reasons distinguish financial and lifecycle outcomes without exposing server detail", () => {
  for (const [code, expected] of Object.entries({ INSUFFICIENT_MARGIN: "수수료", POSITION_LIMIT_REACHED: "포지션 수", PENDING_LIMIT_REACHED: "미체결", ORDER_SIZE_LIMIT_EXCEEDED: "거래대금", ACCOUNT_AT_RISK: "청산 위험", SYMBOL_NOT_AVAILABLE: "중단", POSITION_LIQUIDATION: "강제청산", ORDER_NOT_PENDING: "이미 처리", ACCOUNT_RISK_PENDING: "처리 중", ACCOUNT_RECOVERY_HELD: "운영 검토" })) assert.ok(orderReason(code).includes(expected), code);
  assert.equal(orderReason("POSITION_LIMIT"), orderReason("POSITION_LIMIT_REACHED"));
  assert.equal(orderReason("SYMBOL_NOT_ACTIVE"), orderReason("SYMBOL_NOT_AVAILABLE"));
  assert.equal(orderReason(null), "—");
  for (const secret of ["Bearer sensitive", "<script>internal</script>", "SQL exception"]) assert.equal(orderReason(secret).includes(secret), false);
});
