"use client";

import { reportAdmissionRejection } from "./admission-rejection";
import { useEffect, useState } from "react";
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
  const inputKey = JSON.stringify([snapshot.accountId, snapshot.generation, request]);
  const [settledKey, setSettledKey] = useState(inputKey);
  useEffect(() => {
    // Observed consecutive keystrokes were 73–124ms apart. Coalesce them without
    // delaying submission: the submit handler always obtains its own fresh quote.
    const timer = setTimeout(() => setSettledKey(inputKey), 200);
    return () => clearTimeout(timer);
  }, [inputKey]);
  const settled = settledKey === inputKey;
  const valid=!!request && validQuantity(request.quantity??"") && (request.type==="MARKET"||validLimitPrice(request.limitPrice??""));
  const query=useQuery({queryKey:[...tradingKeys.account(snapshot),"quote",request],enabled:!snapshot.retrying&&snapshot.phase==="ready"&&enabled&&valid&&settled,retry:false,
    staleTime:1000,refetchInterval:3000,queryFn:async ({signal})=>{ try { return await readQuote(session,snapshot,request!,signal); } catch(error) { if (!signal.aborted) reportAdmissionRejection(client,snapshot,error); throw error; } }});
  return { data:valid&&enabled&&settled&&!query.isError ? query.data : undefined, error:valid&&enabled&&settled&&query.error ? mutationMessage(query.error) : null };
}
