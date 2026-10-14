"use client";

import { useQuery } from "@tanstack/react-query";
import { useGuestSession } from "../components/trading-data-provider";
import { parseSummary } from "./account";
import { tradingKeys } from "./query-keys";
import { parseOrders } from "./orders";
import { useEffect, useState } from "react";
import { marketTickersJson } from "./client";
import { parseTickers, visibleTicker } from "../market/tickers";

export function useTradingSummary() {
  const { session, snapshot } = useGuestSession();
  const query = useQuery<ReturnType<typeof parseSummary>>({
    queryKey: tradingKeys.summary(snapshot), enabled: snapshot.phase === "ready",
    refetchInterval: (query) => query.state.status === "error" ? false : 5000,
    queryFn: async ({ signal }) => parseSummary(await session.read("account/summary", snapshot, signal), snapshot.accountId),
  });
  const error = snapshot.phase === "error" || query.isError;
  return {
    data: !error && snapshot.phase === "ready" ? query.data : undefined,
    loading: !error && (snapshot.phase === "loading" || query.isPending), error,
    busy: snapshot.phase === "loading" || query.isFetching,
    retry: () => { if (snapshot.phase === "error") void session.retry(); else if (snapshot.phase === "ready") void query.refetch({ cancelRefetch: false }); },
  };
}

export function useTradingOrders(kind: "pending" | "history") {
  const { session, snapshot } = useGuestSession();
  const query = useQuery<ReturnType<typeof parseOrders>>({
    queryKey: tradingKeys[kind](snapshot), enabled: snapshot.phase === "ready",
    refetchInterval: (query) => query.state.status === "error" ? false : kind === "pending" ? 5000 : 10000,
    queryFn: async ({ signal }) => parseOrders(await session.read(kind === "pending" ? "account/orders/pending" : "account/orders?limit=50", snapshot, signal)),
  });
  const error = snapshot.phase === "error" || query.isError;
  return {
    data: !error && snapshot.phase === "ready" ? query.data : undefined,
    loading: !error && (snapshot.phase === "loading" || query.isPending), error,
    busy: snapshot.phase === "loading" || query.isFetching,
    retry: () => { if (snapshot.phase === "error") void session.retry(); else if (snapshot.phase === "ready") void query.refetch({ cancelRefetch: false }); },
  };
}

export function useMarketTickers() {
  const origin = process.env.NEXT_PUBLIC_TRADING_SERVER_URL || "http://127.0.0.1:8081";
  const query = useQuery<ReturnType<typeof parseTickers>>({ queryKey: ["market", origin, "tickers"],
    queryFn: async ({ signal }) => parseTickers(await marketTickersJson(origin, signal)),
    staleTime: 1000, refetchInterval: (query) => query.state.status === "error" ? false : 2000,
  });
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  return { ...query, tickers: query.isError ? [] : (query.data ?? []).flatMap((ticker) => {
    const visible = visibleTicker(ticker, now - query.dataUpdatedAt);
    return visible ? [visible] : [];
  }) };
}
