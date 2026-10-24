import type { SessionSnapshot } from "./guest-session";
const account = (session: SessionSnapshot) => ["trading-account", session.accountId, session.generation] as const;
export const tradingKeys = {
  account,
  leverage: (session: SessionSnapshot, symbolId: number | null, side: "LONG" | "SHORT" = "LONG") => [...account(session), "leverage", symbolId, side] as const,
  summary: (session: SessionSnapshot) => [...account(session), "summary"] as const,
  pending: (session: SessionSnapshot) => [...account(session), "pending"] as const,
  history: (session: SessionSnapshot) => [...account(session), "history", 50] as const,
};
