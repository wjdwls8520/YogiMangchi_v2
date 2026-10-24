import { orderReason } from "./order-reason";
import { mutationMessage, uncertainMutation, type TradingCommand } from "./mutation-request";
import type { TradingOrder } from "./orders";

export type TradingNotice = { kind: "success" | "error" | "warning"; title: string; message: string; resultKey?: string };
export const NOTICE_LIFETIME = 1500;

function describeOrder(order: TradingOrder, command: TradingCommand): TradingNotice {
  if (order.status === "REJECTED") return { kind: "error", title: "주문이 거절되었습니다", message: `${orderReason(order.reason)} 주문 #${order.orderId} 내역에서 확인해 주세요.` };
  if (order.status === "CANCELED") return { kind: "success", title: "주문이 취소되었습니다", message: `주문 #${order.orderId} 취소 완료` };
  const pending = order.status === "PENDING";
  return { kind: "success", title: pending ? "지정가 주문이 접수되었습니다" : command.kind === "open" ? "주문이 완료되었습니다" : "청산이 완료되었습니다",
    message: `${order.side === "LONG" ? "Long" : "Short"} · ${order.type === "MARKET" ? "시장가" : "지정가"} · 수량 ${order.quantity}${pending ? " · 체결 대기 중" : ""}` };
}
export function orderNotice(order: TradingOrder, command: TradingCommand): TradingNotice {
  return { ...describeOrder(order, command), resultKey: `${order.orderId}:${order.status}` };
}
export function orderFailureNotice(error: unknown): TradingNotice {
  return { kind: uncertainMutation(error) ? "warning" : "error", title: uncertainMutation(error) ? "주문 결과 확인이 필요합니다" : "주문이 실패하였습니다", message: mutationMessage(error) };
}

type NoticeEntry = TradingNotice & { id: number; identity: string };
// Each notice owns its timer; adding another never extends an older notice's lifetime.
export function createNoticeStore(schedule: (callback: () => void, delay: number) => () => void = (callback, delay) => {
  const timer = setTimeout(callback, delay); return () => clearTimeout(timer);
}) {
  let entries: readonly NoticeEntry[] = [], nextId = 0;
  const seen = new Set<string>();
  const listeners = new Set<() => void>(), timers = new Map<number, () => void>();
  const emit = () => listeners.forEach(listener => listener());
  function dismiss(id: number) {
    timers.get(id)?.(); timers.delete(id);
    if (!entries.some(entry => entry.id === id)) return;
    entries = entries.filter(entry => entry.id !== id); emit();
  }
  return {
    getSnapshot: () => entries,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    push(notice: TradingNotice, identity: string) {
      const key = notice.resultKey ? `${identity}:${notice.resultKey}` : undefined;
      if (key && seen.has(key)) return null;
      if (key) { seen.add(key); if (seen.size > 512) seen.delete(seen.values().next().value!); }
      const id = ++nextId;
      entries = [...entries, { ...notice, identity, id }];
      if (notice.kind === "success") timers.set(id, schedule(() => dismiss(id), NOTICE_LIFETIME)); emit();
      return id;
    },
    dismiss,
    clear() { seen.clear(); timers.forEach(cancel => cancel()); timers.clear(); if (entries.length) { entries = []; emit(); } },
  };
}
