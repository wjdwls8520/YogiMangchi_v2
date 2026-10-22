"use client";

import { useQuery } from "@tanstack/react-query";
import { useGuestSession } from "../components/trading-data-provider";
import { tradingKeys } from "./query-keys";
import { readQuote, type QuoteRequest } from "./quote";
import { validQuantity, validLimitPrice } from "./order-input";
import { mutationMessage } from "./mutation-request";

export function useOrderQuote(request: QuoteRequest | null, enabled: boolean) {
  const {session,snapshot}=useGuestSession();
  const valid=!!request && validQuantity(request.quantity??"") && (request.type==="MARKET"||validLimitPrice(request.limitPrice??""));
  const query=useQuery({queryKey:[...tradingKeys.account(snapshot),"quote",request],enabled:!snapshot.retrying&&snapshot.phase==="ready"&&enabled&&valid,retry:false,
    staleTime:1000,refetchInterval:3000,queryFn:({signal})=>readQuote(session,snapshot,request!,signal)});
  return { data:valid&&enabled&&!query.isError ? query.data : undefined, error:valid&&enabled&&query.error ? mutationMessage(query.error) : null };
}
