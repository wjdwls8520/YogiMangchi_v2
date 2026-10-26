"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useGuestSession } from "../components/trading-data-provider";
import { parseSummary } from "./account";
import { tradingKeys } from "./query-keys";
import { parseOrders } from "./orders";
import { useEffect, useState } from "react";
import { marketTickersJson } from "./client";
import { parseTickers, visibleTicker } from "../market/tickers";
import { HISTORY_LIMIT, historyPath, parseClosedPositions, parseFills, parseOrderHistory, validHistoryDates, type HistoryFilters, type HistoryKind } from "./history";

export function useTradingSummary() {
  const { session, snapshot } = useGuestSession();
  const query = useQuery<ReturnType<typeof parseSummary>>({
    queryKey: tradingKeys.summary(snapshot), enabled: !snapshot.retrying && snapshot.phase === "ready",
    refetchInterval: (query) => query.state.status === "error" ? false : 5000,
    queryFn: async ({ signal }) => parseSummary(await session.read("account/summary", snapshot, signal), snapshot.accountId),
  });
  const error = snapshot.phase === "error" || query.isError;
  return {
    data: snapshot.phase === "ready" ? query.data : undefined,
    stale: query.isError && query.data !== undefined,
    loading: !error && (snapshot.phase === "loading" || snapshot.phase === "creating" || (snapshot.phase === "ready" && query.isPending)), error,
    busy: snapshot.phase === "loading" || snapshot.phase === "creating" || query.isFetching,
    retry: () => { if (snapshot.phase === "error") void session.restore(); else if (snapshot.phase === "ready") void query.refetch({ cancelRefetch: false }); },
  };
}

export function useTradingOrders(kind: "pending" | "history") {
  const { session, snapshot } = useGuestSession();
  const query = useQuery<ReturnType<typeof parseOrders>>({
    queryKey: tradingKeys[kind](snapshot), enabled: !snapshot.retrying && snapshot.phase === "ready",
    refetchInterval: (query) => query.state.status === "error" ? false : kind === "pending" ? 5000 : 10000,
    queryFn: async ({ signal }) => parseOrders(await session.read(kind === "pending" ? "account/orders/pending" : "account/orders?limit=50", snapshot, signal)),
  });
  const error = snapshot.phase === "error" || query.isError;
  return {
    data: snapshot.phase === "ready" ? query.data : undefined,
    stale: query.isError && query.data !== undefined,
    loading: !error && (snapshot.phase === "loading" || snapshot.phase === "creating" || (snapshot.phase === "ready" && query.isPending)), error,
    busy: snapshot.phase === "loading" || snapshot.phase === "creating" || query.isFetching,
    retry: () => { if (snapshot.phase === "error") void session.restore(); else if (snapshot.phase === "ready") void query.refetch({ cancelRefetch: false }); },
  };
}

function useAccountHistory<T>(kind: HistoryKind, filters: HistoryFilters, active: boolean,
  parse: (value: unknown, cursor?: number | string) => T, next: (page: T) => number | string | undefined) {
  const { session, snapshot } = useGuestSession();
  const validDates = validHistoryDates(kind, filters);
  const query = useInfiniteQuery({
    queryKey: [...tradingKeys.account(snapshot), "history-page", kind, filters] as const,
    enabled: active && validDates && !snapshot.retrying && snapshot.phase === "ready",
    initialPageParam: undefined as number | string | undefined,
    queryFn: async ({ pageParam, signal }) => parse(await session.read(historyPath(kind, filters, pageParam), snapshot, signal), pageParam),
    getNextPageParam: next,
  });
  return {
    pages: snapshot.phase === "ready" ? query.data?.pages : undefined,
    loading: validDates && snapshot.phase === "ready" && query.isPending,
    error: query.isError && !query.isFetchNextPageError,
    moreError: query.isFetchNextPageError,
    hasMore: query.hasNextPage,
    busy: query.isFetching,
    loadMore: () => { if (query.hasNextPage && !query.isFetching) void query.fetchNextPage(); },
    retry: () => { if (validDates && !snapshot.retrying && snapshot.phase === "ready") void query.refetch({ cancelRefetch: false }); },
  };
}

export function useOrderHistory(filters: HistoryFilters, active: boolean) {
  const query = useAccountHistory("orders", filters, active, parseOrderHistory,
    page => page.length === HISTORY_LIMIT ? page.at(-1)?.orderId : undefined);
  return { ...query, items: query.pages?.flat() };
}
export function useFillHistory(filters: HistoryFilters, active: boolean) {
  const query = useAccountHistory("fills", filters, active, parseFills,
    page => page.length === HISTORY_LIMIT ? page.at(-1)?.fillId : undefined);
  return { ...query, items: query.pages?.flat() };
}
export function useClosedHistory(filters: HistoryFilters, active: boolean) {
  const query = useAccountHistory("closed", filters, active, parseClosedPositions, page => page.nextCursor ?? undefined);
  return { ...query, items: query.pages?.flatMap(page => page.items) };
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
