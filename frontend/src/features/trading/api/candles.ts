"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { marketCandlesJson } from "./client";
import { parseCandles, type CandleInterval } from "../market/candles";

export const candleQueryKey = (origin: string, symbolId: number, interval: CandleInterval) => ["market", origin, "candles", symbolId, interval] as const;
export function useCandleHistory(symbolId: number, interval: CandleInterval) {
  const origin = process.env.NEXT_PUBLIC_TRADING_SERVER_URL || "http://127.0.0.1:8081";
  const queryKey = useMemo(() => candleQueryKey(origin, symbolId, interval), [origin, symbolId, interval]);
  const query = useQuery({ queryKey, staleTime: 0,
    queryFn: async ({ signal }) => parseCandles(await marketCandlesJson(origin, symbolId, interval, signal), interval),
  });
  return { ...query, queryKey };
}
