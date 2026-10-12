"use client";

import { useQuery } from "@tanstack/react-query";
import { useGuestSession } from "../components/trading-data-provider";
import { parseSummary } from "./account";
import { tradingKeys } from "./query-keys";

export function useTradingSummary() {
  const { session, snapshot } = useGuestSession();
  const query = useQuery({
    queryKey: tradingKeys.summary(snapshot), enabled: snapshot.phase === "ready",
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
