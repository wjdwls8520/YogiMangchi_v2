"use client";

import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useGuestSession } from "../components/trading-data-provider";
import { createTradingIntent, mutationMessage, uncertainMutation, type TradingCommand } from "./mutation-request";
import { tradingKeys } from "./query-keys";
import type { GuestSession, SessionSnapshot } from "./guest-session";
import { TradingApiError } from "./client";
import { orderRejection, type OrderIssue } from "./order-preflight";
import type { TradingOrder } from "./orders";

type Rejected = (issue: OrderIssue, command: TradingCommand, identity: SessionSnapshot) => void;
type Failed = (error: Error, command: TradingCommand) => void;
type MutationRequest = { command: TradingCommand; session: SessionSnapshot };
export function tradingMutationEffects(client: Pick<QueryClient, "invalidateQueries">, session: Pick<GuestSession, "getSnapshot">, onRejected?: Rejected, onFailed?: Failed) {
  const current = (identity: SessionSnapshot) => session.getSnapshot().accountId === identity.accountId && session.getSnapshot().generation === identity.generation;
  return {
    onError: (error: Error, request: MutationRequest) => {
      if (!current(request.session)) return;
      const issue = orderRejection(error instanceof TradingApiError ? error.code : undefined, request.command);
      if (error instanceof TradingApiError && error.code === "MARKETABLE_LIMIT_NOT_ALLOWED") void client.invalidateQueries({ queryKey: ["market", process.env.NEXT_PUBLIC_TRADING_SERVER_URL || "http://127.0.0.1:8081", "tickers"] });
      if (issue) onRejected?.(issue, request.command, request.session);
      onFailed?.(error,request.command);
    },
    onSettled: async (_data: TradingOrder | undefined, _error: Error | null, request: MutationRequest) => {
      if (current(request.session)) await client.invalidateQueries({ queryKey: tradingKeys.account(request.session) });
    },
  };
}

export function useTradingMutation(onRejected?: Rejected, onFailed?: Failed) {
  const { session, snapshot } = useGuestSession();
  const client = useQueryClient();
  const [intent] = useState(() => createTradingIntent((request) => session.write(request.command, request.session, request.key)));
  const active = useRef(false);
  const [unconfirmed, setUnconfirmed] = useState<{ command: TradingCommand; session: SessionSnapshot } | null>(null);
  const mutation = useMutation({ retry: false,
    mutationFn: (request: { command: TradingCommand; session: SessionSnapshot }) => intent.execute(request.command, request.session),
    ...tradingMutationEffects(client, session, onRejected,onFailed),
  });
  const sameIdentity = (value: SessionSnapshot) => value.accountId === snapshot.accountId && value.generation === snapshot.generation;
  const pendingConfirmation = unconfirmed && sameIdentity(unconfirmed.session) ? unconfirmed : null;
  async function submit(command: TradingCommand) {
    if (active.current || snapshot.phase !== "ready") return null;
    active.current = true;
    try {
      const order = await mutation.mutateAsync({ command, session: snapshot });
      setUnconfirmed(null);
      return order;
    } catch (error) { setUnconfirmed(uncertainMutation(error) ? { command, session: snapshot } : null); return null; }
    finally { active.current = false; }
  }
  const currentResult = mutation.variables && sameIdentity(mutation.variables.session);
  return { submit, retry: () => pendingConfirmation ? submit(pendingConfirmation.command) : Promise.resolve(null),
    clearError: () => { if (!active.current && !pendingConfirmation) mutation.reset(); },
    command: currentResult ? mutation.variables?.command : null,
    pending: !!currentResult && mutation.isPending, unconfirmed: !!pendingConfirmation,
    error: currentResult && mutation.error ? mutationMessage(mutation.error) : null,
  };
}
