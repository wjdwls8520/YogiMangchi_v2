"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { marketCandlesJson } from "./client";
import { parseCandles, type CandleBook, type CandleInterval } from "../market/candles";
import { CandleHistoryPager } from "../market/candle-history";

export const candleQueryKey = (origin: string, symbolId: number, interval: CandleInterval, before: string | null = null) => ["market", origin, "candles", symbolId, interval, before] as const;
const candleOrigin = () => process.env.NEXT_PUBLIC_TRADING_SERVER_URL || "http://127.0.0.1:8081";
export function useCandleHistory(symbolId: number, interval: CandleInterval) {
  const origin = candleOrigin();
  const queryKey = useMemo(() => candleQueryKey(origin, symbolId, interval), [origin, symbolId, interval]);
  const query = useQuery({ queryKey, staleTime: 0,
    queryFn: async ({ signal }) => parseCandles(await marketCandlesJson(origin, symbolId, interval, signal), interval),
  });
  return { ...query, queryKey };
}

export function useOlderCandleHistory(book: CandleBook, symbolId: number, interval: CandleInterval) {
  const client = useQueryClient(), origin = candleOrigin();
  const pager = useMemo(() => new CandleHistoryPager(book, async (before, signal) => {
    const queryKey = candleQueryKey(origin, symbolId, interval, before);
    const cancel = () => { void client.cancelQueries({ queryKey, exact: true }); };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      return await client.fetchQuery({ queryKey, staleTime: Infinity,
        queryFn: async ({ signal }) => parseCandles(await marketCandlesJson(origin, symbolId, interval, signal, fetch, before), interval),
      });
    } finally { signal.removeEventListener("abort", cancel); }
  }), [book, client, origin, symbolId, interval]);
  const state = useSyncExternalStore(pager.subscribe, pager.getSnapshot, pager.getSnapshot);
  useEffect(() => { pager.activate(); return () => pager.pause(); }, [pager]);
  return { pager, ...state };
}
