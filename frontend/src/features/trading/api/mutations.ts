"use client";

import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useGuestSession } from "../components/trading-data-provider";
import { createTradingIntent, mutationMessage, tradingSubmissionAllowed, unconfirmedMutationMessage, type TradingCommand } from "./mutation-request";
import { tradingKeys } from "./query-keys";
import type { GuestSession, SessionSnapshot } from "./guest-session";
import { useTradingNotices } from "../components/trading-notices";
import { orderNotice, orderFailureNotice } from "./notices";
import { TradingApiError } from "./client";
import { orderRejection, type OrderIssue } from "./order-preflight";
import type { TradingOrder } from "./orders";

import { reportAdmissionRejection } from "./admission-rejection";
import { useTradingAdmission } from "./recovery";

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
      if (!current(request.session)) return;
      const queryKey = tradingKeys.account(request.session);
      const financial = (query: { queryKey: readonly unknown[] }) => ["summary", "pending", "recovery"].includes(String(query.queryKey[3]));
      // Keep the request locked until wallet/positions, reservations and risk state
      // are rechecked. Slow history/performance must not delay its confirmed result.
      const required = client.invalidateQueries({ queryKey, predicate: financial });
      void client.invalidateQueries({ queryKey, predicate: query => !financial(query) }).catch(() => {});
      await required;
    },
  };
}

export function useTradingMutation(onRejected?: Rejected, onFailed?: Failed) {
  const { session, snapshot } = useGuestSession();
  const client = useQueryClient();
  const admission = useTradingAdmission();
  const notices = useTradingNotices();
  const [intent] = useState(() => createTradingIntent((request) => session.write(request.command, request.session, request.key)));
  const active = useRef(false);
  const [unconfirmed, setUnconfirmed] = useState<{ command: TradingCommand; session: SessionSnapshot } | null>(null);
  const effects = tradingMutationEffects(client, session, onRejected, onFailed);
  const isCurrent = (identity: SessionSnapshot) => session.getSnapshot().accountId === identity.accountId && session.getSnapshot().generation === identity.generation;
  const mutation = useMutation({ retry: false,
    mutationFn: (request: { command: TradingCommand; session: SessionSnapshot }) => intent.execute(request.command, request.session),
    ...effects,
    onSuccess: (order, request) => { if (isCurrent(request.session)) notices.push(orderNotice(order, request.command)); },
    onError: (error, request) => {
      if (!isCurrent(request.session)) return;
      reportAdmissionRejection(client, request.session, error);
      if (intent.getUnconfirmed(request.session)) notices.push({kind:"warning",title:"주문 결과가 미확정입니다",message:unconfirmedMutationMessage});
      else { effects.onError(error, request); notices.push(orderFailureNotice(error)); }
    },
  });
  const sameIdentity = (value: SessionSnapshot) => value.accountId === snapshot.accountId && value.generation === snapshot.generation;
  const pendingConfirmation = unconfirmed && sameIdentity(unconfirmed.session) ? unconfirmed : null;
  async function submit(command: TradingCommand, confirming = false) {
    if (active.current || snapshot.retrying || snapshot.phase !== "ready") return null;
    const unresolved = intent.getUnconfirmed(snapshot);
    if (!tradingSubmissionAllowed(command, unresolved, confirming, command.kind === "cancel" ? admission.cancel : admission.trade)) {
      notices.push({kind:"warning",title:unresolved ? "이전 요청을 먼저 확인해 주세요" : "거래 상태를 확인해 주세요",message:unresolved ? "새 주문 대신 같은 요청의 결과 확인을 이용해 주세요." : "서버 또는 계정 복구 상태가 변경되었습니다. 상태 확인 후 직접 다시 요청해 주세요."}); return null;
    }
    active.current = true;
    try {
      const order = await mutation.mutateAsync({ command, session: snapshot });
      if (!isCurrent(snapshot)) return null;
      setUnconfirmed(null);
      return order;
    } catch { if (isCurrent(snapshot)) { const retained = intent.getUnconfirmed(snapshot); setUnconfirmed(retained ? {command:retained.command,session:retained.session} : null); } return null; }
    finally { active.current = false; }
  }
  const currentResult = mutation.variables && sameIdentity(mutation.variables.session);
  return { submit: (command: TradingCommand) => submit(command), blocked: !admission.trade, cancelBlocked: !admission.cancel, retry: () => pendingConfirmation ? submit(pendingConfirmation.command, true) : Promise.resolve(null),
    clearError: () => { if (!active.current && !pendingConfirmation) mutation.reset(); },
    command: currentResult ? mutation.variables?.command : null,
    pending: !!currentResult && mutation.isPending, unconfirmed: !!pendingConfirmation,
    error: pendingConfirmation ? unconfirmedMutationMessage : currentResult && mutation.error ? mutationMessage(mutation.error) : null,
  };
}
