"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGuestSession } from "./trading-data-provider";
import { useTradingNotices } from "./trading-notices";
import { parseTradingEvents, tradingEventNotice, type EventState, type TradingEvent } from "../api/trading-events";
import { tradingKeys } from "../api/query-keys";
import { retryTradingQuery } from "../api/client";
import { orderStatusLabel } from "../api/orders";
import { orderReason } from "../api/order-reason";

function kstTime(value: string) {
  return new Date(value).toLocaleString("sv-SE", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
}

export function eventHistoryDisplay(event: TradingEvent) {
  const notice = tradingEventNotice(event);
  if (notice) return { title: notice.title, detail: notice.message };
  const order = event.order;
  if (!order) return null;
  if (event.type === "ORDER_PENDING") return { title: "주문이 접수되었습니다", detail: `${order.side} · ${order.type} · 주문 #${order.orderId} · ${orderStatusLabel(order.status)}` };
  if (event.type === "ORDER_FILLED") return { title: "주문이 체결되었습니다", detail: `${order.side} · ${order.type} · 주문 #${order.orderId} · 수량 ${order.quantity}` };
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
    queryFn: async ({ signal }) => parseTradingEvents(await session.read("account/events?afterId=0&limit=50", snapshot, signal)),
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
  const committedEvents = (eventsQuery.data ?? initialEvents ?? []).flatMap(event => {
    const summary = eventHistoryDisplay(event);
    return summary ? [{ event, ...summary }] : [];
  });
  return <div className="account-event-state" role="status" aria-live="polite">
    <span>체결 알림 · {state === "live" ? "실시간" : state === "syncing" ? "이력 동기화 중" : state === "reconnecting" ? "재연결 중" : "연결 확인 필요"}</span>
    <button ref={trigger} type="button" className="account-refresh" aria-haspopup="dialog" disabled={snapshot.phase !== "ready"} onClick={() => { setOpen(true); dialog.current?.showModal(); }}>최근 알림 내역</button>
    {state === "unavailable" && <button type="button" className="account-refresh" onClick={() => setAttempt(value => value + 1)}>알림 다시 연결</button>}
    <dialog ref={dialog} open={defaultOpen || undefined} className="position-close-dialog" aria-modal="true" aria-labelledby="trading-events-dialog-title" onClose={() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }}>
      <h2 id="trading-events-dialog-title">최근 알림 내역</h2>
      {eventsQuery.isPending && !committedEvents.length && <p role="status">알림 이력을 불러오는 중…</p>}
      {eventsQuery.isError && <p role="alert">최근 알림 내역을 조회하지 못했습니다.</p>}
      {!eventsQuery.isPending && !eventsQuery.isError && !committedEvents.length && <p>표시할 최근 거래 알림이 없습니다.</p>}
      {committedEvents.length > 0 && <ul className="member-note">
        {committedEvents.map(({ event, title, detail }) => <li key={event.eventId}>
          <strong>{title}</strong> ({event.type}) · {detail} · <time dateTime={event.occurredAt}>{kstTime(event.occurredAt)} KST</time>
        </li>)}
      </ul>}
      <div className="guest-dialog-actions">
        <button type="button" className="account-refresh" disabled={eventsQuery.isFetching} onClick={() => void eventsQuery.refetch()}>새로고침</button>
        <button type="button" className="guest-cancel" onClick={() => dialog.current?.close()}>닫기</button>
      </div>
    </dialog>
  </div>;
}
