"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { TradingSymbol } from "../market/catalog";
import { openMarketStream, type MarketPrice } from "../market/stream";
import { marketTransition, selectedMarket, waitingMarket, type SelectedMarket } from "../market/selected-market";
import { emptyOrderBook, selectedOrderBook, type OrderBook } from "../market/order-book";
import { marketSubscriptionBatches } from "../api/position-display";

export type BookSelection = { symbolId: number; price: string; identity: string };
type Metadata = { symbol: TradingSymbol | null; symbols: readonly TradingSymbol[]; bookSelection?: BookSelection };
const MetadataContext = createContext<Metadata | null>(null);
const PriceContext = createContext<SelectedMarket | null>(null);
const BookContext = createContext<OrderBook | null>(null);
const PositionPriceContext = createContext<Readonly<Record<number,MarketPrice | null>>>({});

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

export function SelectedMarketProvider({ symbol, symbols, market, orderBook, positionPrices = {}, bookSelection, children }: { symbol: TradingSymbol | null; symbols?: readonly TradingSymbol[]; market: SelectedMarket; orderBook: OrderBook; positionPrices?: Readonly<Record<number,MarketPrice|null>>; bookSelection?: BookSelection; children: ReactNode }) {
  const metadata = useMemo(() => ({ symbol, symbols:symbols??(symbol ? [symbol] : []), bookSelection }), [symbol,symbols,bookSelection]);
  return <MetadataContext.Provider value={metadata}><PriceContext.Provider value={market}><BookContext.Provider value={orderBook}><PositionPriceContext.Provider value={positionPrices}>{children}</PositionPriceContext.Provider></BookContext.Provider></PriceContext.Provider></MetadataContext.Provider>;
}
export function LiveMarketProvider({ symbol, symbols, socketUrl, onSymbolUnavailable, positionIds, identity, onSubscriptionUnavailable, bookSelection, children }: {
  symbol: TradingSymbol | null; symbols: readonly TradingSymbol[]; socketUrl:string; onSymbolUnavailable:(id:number)=>void;
  positionIds:string; identity:string; onSubscriptionUnavailable:()=>void; bookSelection?:BookSelection; children:ReactNode;
}) {
  const feed = useMarketFeed(symbol?.id??null,socketUrl,onSymbolUnavailable,positionIds,identity,onSubscriptionUnavailable);
  return <SelectedMarketProvider symbol={symbol} symbols={symbols} {...feed} bookSelection={bookSelection}>{children}</SelectedMarketProvider>;
}
export function useMarketDetails() {
  const context = useContext(MetadataContext);
  if (!context) throw new Error("SelectedMarketProvider required");
  return context;
}
export function useSelectedMarket() {
  const metadata = useMarketDetails(), market = useContext(PriceContext);
  if (!market) throw new Error("SelectedMarketProvider required");
  return {...metadata, market};
}
export function usePositionMarkets() { return useContext(PositionPriceContext); }
export function useSelectedBook() { return useContext(BookContext); }
