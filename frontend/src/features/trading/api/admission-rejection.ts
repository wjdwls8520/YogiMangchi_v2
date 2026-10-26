import type { QueryClient } from "@tanstack/react-query";
import { TradingApiError } from "./client";
import type { SessionSnapshot } from "./guest-session";
import { tradingKeys } from "./query-keys";

export type AdmissionRejection = { code: "ENGINE_RECOVERING" | "ACCOUNT_RISK_PENDING" | "ACCOUNT_RECOVERY_HELD"; at: number };
export const admissionRejectionKey = (snapshot: SessionSnapshot) => [...tradingKeys.account(snapshot), "admission-rejection"] as const;
export function admissionRecheckPending(rejection: AdmissionRejection | null | undefined, engineAt: number, accountAt: number) {
  return !!rejection && (engineAt <= rejection.at + 1000 || accountAt <= rejection.at + 1000);
}
// A rejection is newer evidence than an earlier READY/CLEAR snapshot. Recheck both
// scopes without inventing recovery counts or automatically resubmitting an order.
export function reportAdmissionRejection(client: QueryClient, snapshot: SessionSnapshot, error: unknown) {
  if (!(error instanceof TradingApiError) || !["ENGINE_RECOVERING", "ACCOUNT_RISK_PENDING", "ACCOUNT_RECOVERY_HELD"].includes(error.code ?? "")) return;
  client.setQueryData<AdmissionRejection>(admissionRejectionKey(snapshot), { code: error.code as AdmissionRejection["code"], at: Date.now() });
  const origin = process.env.NEXT_PUBLIC_TRADING_SERVER_URL || "http://127.0.0.1:8081";
  void client.invalidateQueries({ queryKey: ["trading-engine", origin] });
  void client.invalidateQueries({ queryKey: [...tradingKeys.account(snapshot), "recovery"] });
}
