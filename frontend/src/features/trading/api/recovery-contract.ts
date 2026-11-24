import { id, instant, invalidContract, list, nullable, record } from "./contracts";

export function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) return invalidContract();
  return value as number;
}
export function parseEngine(value: unknown) {
  const row = record(value);
  if (row.status !== "READY" && row.status !== "RECOVERING") return invalidContract();
  return row.status;
}
const reasons: Record<string, string> = {
  PROVIDER_CONTINUITY_UNKNOWN: "시세 공급자 연결이 끊긴 구간의 검토가 필요합니다.",
  POSTGRES_INGRESS_INTERRUPTED: "시세 기록이 중단된 구간의 검토가 필요합니다.",
  UNOBSERVED_PRICE_INTERVAL: "관측하지 못한 가격 구간의 검토가 필요합니다.",
  LEDGER_MISMATCH: "금융 원장 불일치 검토가 필요합니다. 운영 확인 전에는 거래할 수 없습니다.",
  PRICE_GAP: "시세 연속성을 확인할 수 없는 구간이 있습니다.",
  RISK_PROCESSING_FAILED: "위험 처리 결과를 검토 중입니다.",
};
export function parseRecovery(value: unknown) {
  const row = record(value);
  if (!["CLEAR", "PENDING", "REVIEW_REQUIRED"].includes(String(row.status))) return invalidContract();
  const holds = list(row.holds, value => {
    const hold = record(value);
    return { holdId: id(hold.holdId), tradingSymbolId: nullable(hold.tradingSymbolId, id),
      riskEventId: nullable(hold.riskEventId, id), heldAt: instant(hold.heldAt),
      reason: typeof hold.reason === "string" ? reasons[hold.reason] ?? "가격 위험 기록의 운영 검토가 필요합니다." : invalidContract() };
  });
  const pendingWork = count(row.pendingWork), heldWork = count(row.heldWork);
  if (row.status === "CLEAR" && (pendingWork || heldWork || holds.length)) return invalidContract();
  return { status: row.status as "CLEAR" | "PENDING" | "REVIEW_REQUIRED", pendingWork, heldWork, holds,
    oldestRiskEventId: nullable(row.oldestRiskEventId, id), oldestReceivedAt: nullable(row.oldestReceivedAt, instant), capturedAt: instant(row.capturedAt) };
}
export function recoveryAdmission(engine: ReturnType<typeof parseEngine> | undefined, recovery: ReturnType<typeof parseRecovery> | undefined) {
  const accountClear = recovery?.status === "CLEAR";
  return { trade: engine === "READY" && accountClear, cancel: !!engine && accountClear };
}
