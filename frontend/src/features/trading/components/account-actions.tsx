"use client";

import type { Position } from "../api/account";
import { validQuantity } from "../api/order-input";
import { useTradingMutation } from "../api/mutations";
import { useGuestSession } from "./trading-data-provider";

export function ClosePositionButton({ position, symbol }: { position: Position; symbol: string }) {
  const action = useTradingMutation();
  const { snapshot } = useGuestSession();
  const reserved = /[1-9]/.test(position.reservedCloseQuantity);
  return <div>
    <button type="button" disabled={action.pending || snapshot.phase !== "ready" || (!action.unconfirmed && (reserved || !validQuantity(position.freeCloseQuantity)))}
      title={reserved ? "예약된 청산 주문을 먼저 취소해 주세요." : undefined}
      aria-label={`${symbol} ${position.side} 포지션 전체 청산`}
      onClick={() => { if (action.unconfirmed) void action.retry(); else void action.submit({ kind: "close", positionId: position.id }); }}>
      {action.pending ? "청산 중" : action.unconfirmed ? "결과 확인" : "전체 청산"}
    </button>
    {reserved && <p className="order-input-hint">청산 예약 있음</p>}
    {action.error && <p role="alert" className="order-input-hint">{action.error}</p>}
  </div>;
}
export function CancelOrderButton({ orderId, symbol }: { orderId: number; symbol: string }) {
  const action = useTradingMutation();
  const { snapshot } = useGuestSession();
  return <div>
    <button type="button" disabled={action.pending || snapshot.phase !== "ready"} aria-label={`${symbol} 주문 #${orderId} 취소`}
      onClick={() => { if (action.unconfirmed) void action.retry(); else void action.submit({ kind: "cancel", orderId }); }}>
      {action.pending ? "취소 중" : action.unconfirmed ? "결과 확인" : "취소"}
    </button>
    {action.error && <p role="alert" className="order-input-hint">{action.error}</p>}
  </div>;
}
