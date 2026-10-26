"use client";

import { reportAdmissionRejection } from "./admission-rejection";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useGuestSession } from "../components/trading-data-provider";
import { tradingKeys } from "./query-keys";
import { readQuote, type QuoteRequest } from "./quote";
import { validQuantity, validLimitPrice } from "./order-input";
import { mutationMessage } from "./mutation-request";

import { useTradingAdmission } from "./recovery";

export function useOrderQuote(request: QuoteRequest | null, enabled: boolean) {
  const admission = useTradingAdmission(), client = useQueryClient();
  enabled = enabled && admission.trade;
  const {session,snapshot}=useGuestSession();
  const valid=!!request && validQuantity(request.quantity??"") && (request.type==="MARKET"||validLimitPrice(request.limitPrice??""));
  const query=useQuery({queryKey:[...tradingKeys.account(snapshot),"quote",request],enabled:!snapshot.retrying&&snapshot.phase==="ready"&&enabled&&valid,retry:false,
    staleTime:1000,refetchInterval:3000,queryFn:async ({signal})=>{ try { return await readQuote(session,snapshot,request!,signal); } catch(error) { if (!signal.aborted) reportAdmissionRejection(client,snapshot,error); throw error; } }});
  return { data:valid&&enabled&&!query.isError ? query.data : undefined, error:valid&&enabled&&query.error ? mutationMessage(query.error) : null };
}
