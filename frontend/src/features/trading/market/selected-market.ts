import type { MarketPrice, MarketState } from "./stream";

export type SelectedMarket = { symbolId: number | null; state: MarketState; price: MarketPrice | null; recovery: number };
export const waitingMarket: SelectedMarket = { symbolId: null, state: "CONNECTING", price: null, recovery: 0 };

export function selectedMarket(snapshot: SelectedMarket, symbolId: number | null): SelectedMarket {
  return snapshot.symbolId === symbolId ? snapshot : { ...waitingMarket, symbolId };
}
export function freshMarkPrice(market: SelectedMarket, now = Date.now()) {
  return market.state === "READY" && (market.price?.expiresAt === undefined || market.price.expiresAt > now) ? market.price : null;
}
export function marketTransition(snapshot: SelectedMarket, symbolId: number, state: MarketState): SelectedMarket {
  const current = selectedMarket(snapshot, symbolId);
  const outage = state !== current.state && (state === "UNAVAILABLE" || state === "RECONNECTING");
  return { ...current, symbolId, state, recovery: current.recovery + (outage ? 1 : 0) };
}
