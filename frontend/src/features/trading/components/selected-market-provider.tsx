"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { TradingSymbol } from "../market/catalog";
import { openMarketStream, type MarketPrice } from "../market/stream";
import { marketTransition, selectedMarket, waitingMarket, type SelectedMarket } from "../market/selected-market";
import { emptyOrderBook, selectedOrderBook, type OrderBook } from "../market/order-book";
import { marketSubscriptionBatches } from "../api/position-display";

const MarketContext = createContext<{ symbol: TradingSymbol | null; market: SelectedMarket; orderBook: OrderBook; positionPrices: Readonly<Record<number,MarketPrice | null>> } | null>(null);

export function useMarketFeed(symbolId: number | null, socketUrl: string, onSymbolUnavailable: (id: number) => void, positionIds: string = "[]", identity = "public", onSubscriptionUnavailable?: () => void) {
  const [snapshot, setSnapshot] = useState(waitingMarket);
  const [book, setBook] = useState(() => emptyOrderBook(null));
  const key = `${symbolId}:${positionIds}:${identity}`;
  const [marks,setMarks] = useState<{key:string;prices:Record<number,MarketPrice|null>}>({key:"",prices:{}});
  useEffect(() => {
    if (symbolId === null) return;
    const stops = marketSubscriptionBatches(symbolId,JSON.parse(positionIds) as number[]).map(ids=>openMarketStream({
      url:socketUrl,symbolId:ids[0],subscriptionIds:ids,onSymbolUnavailable,onSubscriptionUnavailable,
      onMarketPrice:(id,price)=>setMarks(current=>({key,prices:{...(current.key===key ? current.prices : {}),[id]:price}})),
      onOrderBook:ids[0]===symbolId ? setBook : undefined,
      onState:ids[0]===symbolId ? (state)=>setSnapshot(current=>marketTransition(current,symbolId,state)) : ()=>{},
      onPrice:ids[0]===symbolId ? (price)=>setSnapshot(current=>({...selectedMarket(current,symbolId),symbolId,price})) : ()=>{},
    }));
    return ()=>stops.forEach(stop=>stop());
  }, [symbolId, socketUrl, onSymbolUnavailable,positionIds,key,onSubscriptionUnavailable]);
  return { market: selectedMarket(snapshot, symbolId), orderBook: selectedOrderBook(book, symbolId), positionPrices:marks.key===key ? marks.prices : {} };
}

export function SelectedMarketProvider({ symbol, market, orderBook, positionPrices = {}, children }: { symbol: TradingSymbol | null; market: SelectedMarket; orderBook: OrderBook; positionPrices?: Readonly<Record<number,MarketPrice|null>>; children: ReactNode }) {
  return <MarketContext.Provider value={{ symbol, market, orderBook, positionPrices }}>{children}</MarketContext.Provider>;
}
export function useSelectedMarket() {
  const context = useContext(MarketContext);
  if (!context) throw new Error("SelectedMarketProvider required");
  return context;
}
