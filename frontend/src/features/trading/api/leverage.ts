"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useGuestSession } from "../components/trading-data-provider";
import { leveragePath, parseLeverage, validLeverage } from "./leverage-contract";
import { tradingKeys } from "./query-keys";
import { mutationMessage, uncertainMutation } from "./mutation-request";

export function useSymbolLeverage(symbolId: number | null) {
  const { session, snapshot } = useGuestSession(), client = useQueryClient();
  const active = useRef(false);
  const query = useQuery<ReturnType<typeof parseLeverage>>({
    queryKey: tradingKeys.leverage(snapshot, symbolId), enabled: snapshot.phase === "ready" && symbolId !== null,
    staleTime: 0, refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => parseLeverage(await session.read(leveragePath(symbolId!), snapshot, signal), symbolId!),
  });
  const mutation = useMutation({ retry: false,
    mutationFn: async (request: { symbolId: number; leverage: number; identity: typeof snapshot }) => {
      // Cancel older reads before committing a change, so old settings cannot overwrite its response.
      await client.cancelQueries({ queryKey: tradingKeys.account(request.identity) });
      return session.changeLeverage(request.symbolId, request.leverage, request.identity);
    },
    onSuccess: (value, request) => {
      const current = session.getSnapshot();
      if (current.accountId === request.identity.accountId && current.generation === request.identity.generation)
        client.setQueryData(tradingKeys.leverage(request.identity, request.symbolId), value);
    },
    onSettled: async (_value, _error, request) => {
      const current = session.getSnapshot();
      if (current.accountId === request.identity.accountId && current.generation === request.identity.generation)
        await client.invalidateQueries({ queryKey: tradingKeys.account(request.identity) });
    },
  });
  const current = mutation.variables?.identity.accountId === snapshot.accountId
    && mutation.variables?.identity.generation === snapshot.generation && mutation.variables?.symbolId === symbolId;
  const data = snapshot.phase === "ready" && !query.isError ? query.data : undefined;
  const blocked = () => active.current || query.isFetching || !data;
  async function change(leverage: number) {
    if (blocked() || symbolId === null || !data || !validLeverage(leverage, data.maxLeverage) || leverage === data.leverage) return;
    active.current = true;
    try { await mutation.mutateAsync({ symbolId, leverage, identity: snapshot }); }
    catch { /* Show a safe local message. Refetch resolves uncertain PUT outcomes without resubmitting orders. */ }
    finally { active.current = false; }
  }
  return { data, pending: mutation.isPending, blocked, change,
    ready: !!data && !query.isFetching && !mutation.isPending,
    error: current && mutation.error ? (uncertainMutation(mutation.error) ? "레버리지 변경 결과를 확인할 수 없습니다. 서버 설정을 다시 조회해 주세요. 주문은 자동 제출하지 않습니다." : mutationMessage(mutation.error)) : query.isError ? "레버리지 설정을 조회하지 못했습니다. 다시 조회해 주세요." : null,
    refresh: () => { if (!mutation.isPending) mutation.reset(); return query.refetch({ cancelRefetch: false }); },
  };
}
