import type { SessionSnapshot } from "./guest-session";
const account = (session: SessionSnapshot) => ["trading-account", session.accountId, session.generation] as const;
const scope = (session: SessionSnapshot) => (session.contestSeasonId ? ([`contest:${session.contestSeasonId}`] as const) : ([] as const));
export const tradingKeys = {
  account,
  leverage: (session: SessionSnapshot, symbolId: number | null, side: "LONG" | "SHORT" = "LONG") => [...account(session), "leverage", symbolId, side, ...scope(session)] as const,
  summary: (session: SessionSnapshot) => [...account(session), "summary", ...scope(session)] as const,
  pending: (session: SessionSnapshot) => [...account(session), "pending", ...scope(session)] as const,
  history: (session: SessionSnapshot) => [...account(session), "history", 50, ...scope(session)] as const,
};
