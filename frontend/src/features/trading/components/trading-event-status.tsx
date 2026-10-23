"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGuestSession } from "./trading-data-provider";
import { useTradingNotices } from "./trading-notices";
import { tradingEventNotice, type EventState } from "../api/trading-events";
import { tradingKeys } from "../api/query-keys";

export function TradingEventStatus() {
  const { session, snapshot } = useGuestSession();
  const client = useQueryClient(), notices = useTradingNotices();
  const [attempt, setAttempt] = useState(0), [state, setState] = useState<EventState>("syncing");
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
  return <div className="account-event-state" role="status" aria-live="polite">
    <span>체결 알림 · {state === "live" ? "실시간" : state === "syncing" ? "이력 동기화 중" : state === "reconnecting" ? "재연결 중" : "연결 확인 필요"}</span>
    {state === "unavailable" && <button type="button" className="account-refresh" onClick={() => setAttempt(value => value + 1)}>알림 다시 연결</button>}
  </div>;
}
