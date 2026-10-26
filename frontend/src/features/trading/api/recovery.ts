"use client";
import { admissionRecheckPending, admissionRejectionKey, type AdmissionRejection } from "./admission-rejection";
import { useQuery } from "@tanstack/react-query";
import { useGuestSession } from "../components/trading-data-provider";
import { tradingJson } from "./client";
import { tradingKeys } from "./query-keys";
import { parseEngine, parseRecovery, recoveryAdmission } from "./recovery-contract";

export function useTradingAdmission() {
  const { session, snapshot } = useGuestSession();
  const origin = process.env.NEXT_PUBLIC_TRADING_SERVER_URL || "http://127.0.0.1:8081";
  const enabled = snapshot.phase === "ready" && !snapshot.retrying;
  const engine = useQuery({ queryKey: ["trading-engine", origin], enabled, staleTime: 1000, refetchInterval: 3000,
    queryFn: async ({ signal }) => parseEngine(await tradingJson(origin, "status", { signal })) });
  const account = useQuery({ queryKey: [...tradingKeys.account(snapshot), "recovery"], enabled, staleTime: 1000, refetchInterval: 3000,
    queryFn: async ({ signal }) => parseRecovery(await session.read("account/recovery", snapshot, signal)) });
  const rejection = useQuery<AdmissionRejection | null>({ queryKey: admissionRejectionKey(snapshot), initialData: null, enabled: false, queryFn: () => null });
  const rechecking = admissionRecheckPending(rejection.data, engine.dataUpdatedAt, account.dataUpdatedAt);
  const available = !rechecking && enabled && !engine.isError && !account.isError;
  return { ...recoveryAdmission(available ? engine.data : undefined, available ? account.data : undefined),
    rechecking, engine: engine.data, account: available ? account.data : undefined,
    error: engine.isError || account.isError, refresh: () => { void engine.refetch(); void account.refetch(); } };
}
