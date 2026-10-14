import type { MarketPrice, MarketState } from "./stream";

export type SelectedMarket = { symbolId: number | null; state: MarketState; price: MarketPrice | null };
export const waitingMarket: SelectedMarket = { symbolId: null, state: "CONNECTING", price: null };

export function selectedMarket(snapshot: SelectedMarket, symbolId: number | null): SelectedMarket {
  return snapshot.symbolId === symbolId ? snapshot : { ...waitingMarket, symbolId };
}
export function freshMarkPrice(market: SelectedMarket) {
  return market.state === "READY" ? market.price : null;
}
