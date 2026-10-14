"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { TradingSymbol } from "../market/catalog";
import { openMarketStream } from "../market/stream";
import { selectedMarket, waitingMarket, type SelectedMarket } from "../market/selected-market";

const MarketContext = createContext<{ symbol: TradingSymbol | null; market: SelectedMarket } | null>(null);

export function useMarketFeed(symbolId: number | null, socketUrl: string, onSymbolUnavailable: (id: number) => void) {
  const [snapshot, setSnapshot] = useState(waitingMarket);
  useEffect(() => {
    if (symbolId === null) return;
    return openMarketStream({ url: socketUrl, symbolId, onSymbolUnavailable,
      onState: (state) => setSnapshot((current) => ({ ...selectedMarket(current, symbolId), symbolId, state })),
      onPrice: (price) => setSnapshot((current) => ({ ...selectedMarket(current, symbolId), symbolId, price })),
    });
  }, [symbolId, socketUrl, onSymbolUnavailable]);
  return selectedMarket(snapshot, symbolId);
}

export function SelectedMarketProvider({ symbol, market, children }: { symbol: TradingSymbol | null; market: SelectedMarket; children: ReactNode }) {
  return <MarketContext.Provider value={{ symbol, market }}>{children}</MarketContext.Provider>;
}
export function useSelectedMarket() {
  const context = useContext(MarketContext);
  if (!context) throw new Error("SelectedMarketProvider required");
  return context;
}
