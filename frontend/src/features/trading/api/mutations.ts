"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useGuestSession } from "../components/trading-data-provider";
import { createTradingIntent, mutationMessage, uncertainMutation, type TradingCommand } from "./mutation-request";
import { tradingKeys } from "./query-keys";
import type { SessionSnapshot } from "./guest-session";

export function useTradingMutation() {
  const { session, snapshot } = useGuestSession();
  const client = useQueryClient();
  const [intent] = useState(() => createTradingIntent((request) => session.write(request.command, request.session, request.key)));
  const active = useRef(false);
  const [unconfirmed, setUnconfirmed] = useState<{ command: TradingCommand; session: SessionSnapshot } | null>(null);
  const mutation = useMutation({ retry: false,
    mutationFn: (request: { command: TradingCommand; session: SessionSnapshot }) => intent.execute(request.command, request.session),
    onSettled: async (_data, _error, request) => {
      if (session.getSnapshot().accountId === request.session.accountId && session.getSnapshot().generation === request.session.generation) {
        await client.invalidateQueries({ queryKey: tradingKeys.account(request.session) });
      }
    },
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
    pending: !!currentResult && mutation.isPending, unconfirmed: !!pendingConfirmation,
    error: currentResult && mutation.error ? mutationMessage(mutation.error) : null,
  };
}
