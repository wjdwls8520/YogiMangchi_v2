import type { TradingSymbol } from "../market/catalog";
import { freshOrderBook, type OrderBook } from "../market/order-book";
import { formatMarketPrice } from "../market/price-format";
import { formatDecimal } from "../api/account";

export function OrderBookPanel({ symbol, book, mark }: {
  symbol: TradingSymbol | null; book: OrderBook; mark?: string;
}) {
  const fresh = book.symbolId === symbol?.id && book.status === "FRESH" && freshOrderBook(book).status === "FRESH";
  const levels = (side: "ask" | "bid") => {
    const rows = fresh ? (side === "ask" ? [...book.asks.slice(0,10)].reverse() : book.bids.slice(0,10)) : [];
    return <div role="group" aria-label={side === "ask" ? "매도 호가" : "매수 호가"}>
      {rows.map((level) => <div key={level.price} className="order-book-level" data-book-side={side}>
        <span>{formatMarketPrice(level.price, symbol?.priceTickSize)}</span><span>{formatDecimal(level.quantity)}</span>
      </div>)}
    </div>;
  };
  return <aside className="order-book" aria-labelledby="order-book-heading">
    <header className="section-heading"><h3 id="order-book-heading" className="section-title">Order Book</h3><span className="preview-label">Binance 참고 호가</span></header>
    <p className="order-book-note">Binance 시장 참고 정보입니다. 모의투자의 체결 가능 수량이 아니며 주문과 연결되지 않습니다.</p>
    <div className="order-book-columns"><span>가격 · USDT</span><span>수량 · {symbol?.symbol ?? "—"}</span></div>
    {levels("ask")}
    <div className="order-book-mark"><span>Mark Price</span><strong>{formatMarketPrice(mark, symbol?.priceTickSize)}</strong></div>
    {levels("bid")}
    <p role="status" className="order-book-note">{fresh ? "상위 매도·매수 각 10개 · 최신 호가" : book.status === "STALE" ? "호가가 만료되었습니다. 최신 호가를 기다립니다." : "호가를 이용할 수 없습니다. 수신을 기다리는 중입니다."}</p>
  </aside>;
}
