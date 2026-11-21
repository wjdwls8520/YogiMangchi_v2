import { useEffect, useRef, useState } from "react";
import type { TradingSymbol } from "../market/catalog";
import { freshOrderBook, type OrderBook } from "../market/order-book";
import { formatMarketPrice } from "../market/price-format";
import { formatQuantity } from "../api/account";

export function OrderBookPanel({ symbol, book, mark, trend = "flat", onSelectPrice }: {
  symbol: TradingSymbol | null; book: OrderBook; mark?: string; trend?: "up" | "down" | "flat"; onSelectPrice?: (price: string) => void;
}) {
  const container = useRef<HTMLElement>(null);
  const [visibleRows, setVisibleRows] = useState(10);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const resize = () => {
      if (!window.matchMedia("(min-width: 64rem)").matches) { setVisibleRows(10); return; }
      const chrome = Array.from(element.children).filter(child => child.getAttribute("role") !== "group").reduce((sum, child) => sum + child.getBoundingClientRect().height, 0);
      setVisibleRows(Math.max(0, Math.min(10, Math.floor((element.clientHeight - chrome) / 48))));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => observer.disconnect();
  }, []);
  const fresh = book.symbolId === symbol?.id && book.status === "FRESH" && freshOrderBook(book).status === "FRESH";
  const levels = (side: "ask" | "bid") => {
    const rows = fresh ? (side === "ask" ? [...book.asks.slice(0,visibleRows)].reverse() : book.bids.slice(0,visibleRows)) : [];
    // Number conversion is only for the decorative depth bar, never for orders or balances.
    const peak = Math.max(...rows.map(level => Number.isFinite(Number(level.quantity)) ? Number(level.quantity) : 0), Number.MIN_VALUE);
    return <div role="group" aria-label={side === "ask" ? "매도 호가" : "매수 호가"}>
      {rows.map((level) => <button type="button" key={level.price} className="order-book-level" data-book-side={side} disabled={!onSelectPrice}
        aria-label={`${level.price} USDT 지정가 입력`} onClick={() => { if (freshOrderBook(book).status === "FRESH") onSelectPrice?.(level.price); }}>
        <i aria-hidden="true" className="order-book-depth" style={{width:`${Math.min(100, Number(level.quantity) / peak * 100)}%`}} />
        <span title={level.price}>{formatMarketPrice(level.price, symbol?.priceTickSize)}</span><span title={level.quantity}>{formatQuantity(level.quantity)}</span>
      </button>)}
    </div>;
  };
  return <aside ref={container} className="order-book" aria-labelledby="order-book-heading">
    <header className="section-heading"><h3 id="order-book-heading" className="section-title">Order Book</h3></header>
    <div className="order-book-columns"><span>가격(USDT)</span><span>수량({symbol?.symbol ?? "—"})</span></div>
    {levels("ask")}
    <div className="order-book-mark"><span>Mark Price</span><strong data-trend={trend}>{formatMarketPrice(mark, symbol?.priceTickSize)}</strong></div>
    {levels("bid")}
    {!fresh && <p role="status" className="order-book-note">{book.status === "STALE" ? "호가 갱신 대기 중…" : "호가 수신 대기 중…"}</p>}
  </aside>;
}
