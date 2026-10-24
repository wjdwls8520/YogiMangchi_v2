"use client";
import { useTradingAdmission } from "../api/recovery";
export function RecoveryStatus() {
  const state = useTradingAdmission();
  const message = state.rechecking ? "서버가 거래 준비 미완료를 알렸습니다. 상태 재확인 중이며 주문은 자동 재전송하지 않습니다." : state.error ? "거래 상태를 확인하지 못했습니다. 상태 재조회 후 직접 요청해 주세요."
    : state.account?.status === "REVIEW_REQUIRED" ? "위험 처리 보류 · 운영 검토가 필요합니다. 새 시세가 도착해도 자동 해제되지 않습니다."
    : state.account?.status === "PENDING" ? "수신된 위험 작업을 복구 중입니다. 완료 후 상태를 확인하고 직접 요청해 주세요."
    : state.engine === "RECOVERING" ? "서버 복구 중 · 신규 주문과 청산이 제한됩니다. 계정 상태가 정상이면 취소할 수 있습니다."
    : state.trade ? "거래 정상 · 주문마다 서버가 최신 가격과 위험 상태를 다시 검증합니다." : "서버와 계정의 거래 상태를 확인하는 중입니다.";
  return <section className="wallet-overview" aria-label="거래 처리 상태"><h3>거래 처리 상태</h3><p className="order-input-hint" role="status">{message}</p>
    {state.account && state.account.status !== "CLEAR" && <p className="order-input-hint">대기 {state.account.pendingWork}건 · 보류 {state.account.heldWork}건 · 시세 단절 검토 {state.account.holds.length}건{state.account.oldestReceivedAt && ` · 최초 수신 ${new Date(state.account.oldestReceivedAt).toLocaleString("ko-KR")}`}</p>}
    {state.account?.holds.map(hold => <p key={hold.holdId} className="order-input-hint">{hold.tradingSymbolId ? `종목 #${hold.tradingSymbolId} · ` : "계정 · "}{hold.reason} · {new Date(hold.heldAt).toLocaleString("ko-KR")}</p>)}
    {!state.trade && <button className="account-refresh" type="button" onClick={state.refresh}>상태 다시 조회</button>}
    <p className="order-input-hint">화면 연결 상태와 서버 자동 체결·청산 상태는 별개입니다.</p>
  </section>;
}
