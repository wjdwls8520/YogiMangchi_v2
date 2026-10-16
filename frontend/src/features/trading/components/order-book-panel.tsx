import type { TradingSymbol } from "../market/catalog";
import { freshOrderBook, type OrderBook } from "../market/order-book";
import { formatMarketPrice } from "../market/price-format";
import { formatDecimal } from "../api/account";

export function OrderBookPanel({ symbol, book, mark, disabled, onSelectPrice }: {
  symbol: TradingSymbol | null; book: OrderBook; mark?: string; disabled: boolean; onSelectPrice: (price: string) => void;
}) {
  const fresh = book.symbolId === symbol?.id && book.status === "FRESH" && freshOrderBook(book).status === "FRESH";
  const levels = (side: "ask" | "bid") => {
    const rows = fresh ? (side === "ask" ? [...book.asks.slice(0,10)].reverse() : book.bids.slice(0,10)) : [];
    return <div role="group" aria-label={side === "ask" ? "매도 호가" : "매수 호가"}>
      {rows.map((level) => <button key={level.price} type="button" className="order-book-level" data-book-side={side} data-price={level.price}
        disabled={disabled} onClick={() => { if (freshOrderBook(book).status === "FRESH") onSelectPrice(level.price); }} aria-label={`${side === "ask" ? "매도" : "매수"} 호가 ${level.price} USDT 선택`}>
        <span>{formatMarketPrice(level.price, symbol?.priceTickSize)}</span><span>{formatDecimal(level.quantity)}</span>
      </button>)}
    </div>;
  };
  return <aside className="order-book" aria-labelledby="order-book-heading">
    <header className="section-heading"><h3 id="order-book-heading" className="section-title">Order Book</h3><span className="preview-label">Binance 참고 호가</span></header>
    <p className="order-book-note">시장 참고 수량이며 모의투자의 체결 가능 수량이 아닙니다. 가격을 선택하면 지정가만 입력됩니다.</p>
    <div className="order-book-columns"><span>가격 · USDT</span><span>수량 · {symbol?.symbol ?? "—"}</span></div>
    {levels("ask")}
    <div className="order-book-mark"><span>Mark Price</span><strong>{formatMarketPrice(mark, symbol?.priceTickSize)}</strong></div>
    {levels("bid")}
    <p role="status" className="order-book-note">{fresh ? "상위 매도·매수 각 10개 · 최신 호가" : book.status === "STALE" ? "호가가 만료되었습니다. 최신 호가를 기다립니다." : "호가를 이용할 수 없습니다. 수신을 기다리는 중입니다."}</p>
  </aside>;
}
