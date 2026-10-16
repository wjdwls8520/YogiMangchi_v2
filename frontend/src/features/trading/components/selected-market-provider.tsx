"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { TradingSymbol } from "../market/catalog";
import { openMarketStream } from "../market/stream";
import { marketTransition, selectedMarket, waitingMarket, type SelectedMarket } from "../market/selected-market";
import { emptyOrderBook, selectedOrderBook, type OrderBook } from "../market/order-book";

const MarketContext = createContext<{ symbol: TradingSymbol | null; market: SelectedMarket; orderBook: OrderBook } | null>(null);

export function useMarketFeed(symbolId: number | null, socketUrl: string, onSymbolUnavailable: (id: number) => void) {
  const [snapshot, setSnapshot] = useState(waitingMarket);
  const [book, setBook] = useState(() => emptyOrderBook(null));
  useEffect(() => {
    if (symbolId === null) return;
    return openMarketStream({ url: socketUrl, symbolId, onSymbolUnavailable,
      onOrderBook: setBook,
      onState: (state) => setSnapshot((snapshot) => marketTransition(snapshot, symbolId, state)),
      onPrice: (price) => setSnapshot((current) => ({ ...selectedMarket(current, symbolId), symbolId, price })),
    });
  }, [symbolId, socketUrl, onSymbolUnavailable]);
  return { market: selectedMarket(snapshot, symbolId), orderBook: selectedOrderBook(book, symbolId) };
}

export function SelectedMarketProvider({ symbol, market, orderBook, children }: { symbol: TradingSymbol | null; market: SelectedMarket; orderBook: OrderBook; children: ReactNode }) {
  return <MarketContext.Provider value={{ symbol, market, orderBook }}>{children}</MarketContext.Provider>;
}
export function useSelectedMarket() {
  const context = useContext(MarketContext);
  if (!context) throw new Error("SelectedMarketProvider required");
  return context;
}
