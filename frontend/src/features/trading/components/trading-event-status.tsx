"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGuestSession } from "./trading-data-provider";
import { useTradingNotices } from "./trading-notices";
import { parseLatestTradingEvents, tradingEventNotice, type EventState, type TradingEvent } from "../api/trading-events";
import { tradingKeys } from "../api/query-keys";
import { retryTradingQuery } from "../api/client";
import { orderStatusLabel } from "../api/orders";
import { orderReason } from "../api/order-reason";
import { formatEditableDecimal } from "../api/order-input";
import { formatMarketPrice } from "../market/price-format";
import type { StopLoss } from "../api/stop-loss-contract";
import type { TakeProfit } from "../api/take-profit-contract";

function kstTime(value: string) {
  return new Date(value).toLocaleString("sv-SE", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
}

function stopLossTitle(status: StopLoss["status"]) {
  switch (status) {
    case "ACTIVE": return "손절(SL)이 설정되었습니다";
    case "CANCELED": return "손절(SL)이 해제되었습니다";
    case "TRIGGERED": return "손절(SL)이 발동되었습니다";
    case "EXPIRED": return "손절(SL)이 만료되었습니다";
    default: return "손절 상태가 변경되었습니다";
  }
}

function takeProfitTitle(status: TakeProfit["status"]) {
  switch (status) {
    case "ACTIVE": return "익절(TP)이 설정되었습니다";
    case "CANCELED": return "익절(TP)이 해제되었습니다";
    case "TRIGGERED": return "익절(TP)이 발동되었습니다";
    case "EXPIRED": return "익절(TP)이 만료되었습니다";
    default: return "익절 상태가 변경되었습니다";
  }
}

export function eventHistoryDisplay(event: TradingEvent) {
  const notice = tradingEventNotice(event);
  if (notice) return { title: notice.title, detail: notice.message };
  if (event.type === "STOP_LOSS_CHANGED") {
    const sl = event.stopLoss;
    if (!sl) return null;
    return {
      title: stopLossTitle(sl.status),
      detail: `포지션 #${sl.positionId} · ${sl.side}${sl.stopPrice ? ` · Mark ${formatMarketPrice(sl.stopPrice)}` : ""}`,
    };
  }
  if (event.type === "TAKE_PROFIT_CHANGED") {
    const tp = event.takeProfit;
    if (!tp) return null;
    return {
      title: takeProfitTitle(tp.status),
      detail: `포지션 #${tp.positionId} · ${tp.side}${tp.takeProfitPrice ? ` · Mark ${formatMarketPrice(tp.takeProfitPrice)}` : ""}`,
    };
  }
  const order = event.order;
  if (!order) return null;
  if (event.type === "ORDER_PENDING") return { title: "주문이 접수되었습니다", detail: `${order.side} · ${order.type} · 주문 #${order.orderId} · ${orderStatusLabel(order.status)}` };
  if (event.type === "ORDER_FILLED") return { title: "주문이 체결되었습니다", detail: `${order.side} · ${order.type} · 주문 #${order.orderId} · 수량 ${formatEditableDecimal(order.quantity)}` };
  if (event.type === "ORDER_CANCELED") return { title: "주문이 취소되었습니다", detail: `${order.side} · ${order.type} · 주문 #${order.orderId} · ${orderStatusLabel(order.status)}` };
  if (event.type === "ORDER_REJECTED") return { title: "주문이 거절되었습니다", detail: `${orderReason(order.reason)} 주문 #${order.orderId}` };
  if (event.type === "POSITION_LIQUIDATED") return { title: "포지션이 강제청산되었습니다", detail: `${order.side} · 주문 #${order.orderId} · 체결 내역을 확인해 주세요.` };
  return null;
}

export function TradingEventStatus({ initialEvents, defaultOpen = false }: { initialEvents?: readonly TradingEvent[]; defaultOpen?: boolean } = {}) {
  const { session, snapshot } = useGuestSession();
  const client = useQueryClient(), notices = useTradingNotices();
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const [attempt, setAttempt] = useState(0), [state, setState] = useState<EventState>("syncing"), [open, setOpen] = useState(defaultOpen);
  const eventsQuery = useQuery({
    queryKey: [...tradingKeys.account(snapshot), "events-history"],
    enabled: open && snapshot.phase === "ready" && !snapshot.retrying,
    retry: retryTradingQuery,
    queryFn: async ({ signal }) =>
      parseLatestTradingEvents(await session.read("account/events?afterId=0&limit=50&latest=true", snapshot, signal)),
  });
  useEffect(() => {
    if (snapshot.phase !== "ready" || snapshot.retrying) return;
    let refresh: ReturnType<typeof setTimeout> | undefined;
    const queueRefresh = () => {
      if (refresh !== undefined) return;
      refresh = setTimeout(() => {
        refresh = undefined;
        void client.invalidateQueries({ queryKey: tradingKeys.account(snapshot), refetchType: snapshot.mode === "member" && document.visibilityState === "hidden" ? "none" : "active" }, { cancelRefetch: false });
      }, 100);
    };
    const stop = session.watchEvents(snapshot, event => {
      queueRefresh();
      const notice = tradingEventNotice(event);
      if (notice) notices.push(notice);
    }, setState, queueRefresh);
    return () => { stop(); if (refresh !== undefined) clearTimeout(refresh); };
  }, [session, snapshot, client, notices, attempt]);
  useEffect(() => {
    if (snapshot.phase !== "ready" || snapshot.retrying || state !== "unavailable") return;
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const retry = () => { setAttempt(value => value + 1); };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") retry();
    };
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [snapshot.phase, snapshot.retrying, state]);
  const committedEvents = (eventsQuery.data ?? initialEvents ?? []).flatMap(event => {
    const summary = eventHistoryDisplay(event);
    return summary ? [{ event, ...summary }] : [];
  });
  return <div className="account-event-state" role="status" aria-live="polite">
    <span>체결 알림 · {state === "live" ? "실시간" : state === "syncing" ? "이력 동기화 중" : state === "reconnecting" ? "재연결 중" : "연결 확인 필요"}</span>
    <button ref={trigger} type="button" className="account-refresh" aria-haspopup="dialog" disabled={snapshot.phase !== "ready"} onClick={() => { setOpen(true); dialog.current?.showModal(); }}>최근 알림 내역</button>
    {state === "unavailable" && <button type="button" className="account-refresh" onClick={() => setAttempt(value => value + 1)}>알림 다시 연결</button>}
    <dialog ref={dialog} open={defaultOpen || undefined} className="position-close-dialog ym-exchange-modal" aria-modal="true" aria-labelledby="trading-events-dialog-title"
      onClick={event => { if (event.target === event.currentTarget && event.detail < 2) dialog.current?.close(); }}
      onClose={() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }}>
      <header className="ym-modal-header">
        <h2 id="trading-events-dialog-title">최근 알림 내역</h2>
        <button type="button" className="ym-modal-close" aria-label="닫기" onClick={() => dialog.current?.close()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      {eventsQuery.isPending && !committedEvents.length && <p role="status" className="ym-modal-subtle">알림 이력을 불러오는 중…</p>}
      {eventsQuery.isError && <p role="alert" className="ym-modal-alert">최근 알림 내역을 조회하지 못했습니다.</p>}
      {!eventsQuery.isPending && !eventsQuery.isError && !committedEvents.length && <p className="ym-modal-subtle">표시할 최근 거래 알림이 없습니다.</p>}
      {committedEvents.length > 0 && <ul className="member-note max-h-[55dvh] space-y-2 overflow-y-auto pr-1">
        {committedEvents.map(({ event, title, detail }) => <li key={event.eventId} className="rounded-md border border-[#2B3139] bg-[#1E2329] p-2.5 text-xs text-[#EAECEF]">
          <strong>{title}</strong> <span className="text-[#848E9C]">({event.type})</span> · {detail} · <time className="text-[#848E9C]" dateTime={event.occurredAt}>{kstTime(event.occurredAt)} KST</time>
        </li>)}
      </ul>}
      <div className="ym-modal-footer mt-4" style={{ gridTemplateColumns: "1fr" }}>
        <button type="button" className="guest-cancel ym-modal-btn-cancel" onClick={() => dialog.current?.close()}>닫기</button>
      </div>
    </dialog>
  </div>;
}
