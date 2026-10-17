"use client";

import { useTradingMutation } from "../api/mutations";
import { useGuestSession } from "./trading-data-provider";

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
