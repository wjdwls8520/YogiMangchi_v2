import type { MarketTicker } from "../market/tickers";
import { formatDecimal, pnlTrend } from "../api/account";
import type { TradingSymbol } from "../market/catalog";

export function SymbolSelector({ symbols, tickers, selectedId, onSelect }: {
  tickers: readonly MarketTicker[];
  symbols: readonly TradingSymbol[]; selectedId: number | null; onSelect: (id: number) => void;
}) {
  return (
    <div role="group" aria-label="차트 종목 선택" className="market-selector">
        {symbols.map((market) => {
          const ticker = tickers.find((ticker) => ticker.tradingSymbolId === market.id && ticker.symbol === market.symbol && ticker.quoteAsset === market.quoteAsset);
          return (
          <button key={market.id} type="button" onClick={() => onSelect(market.id)} aria-label={`${market.symbol} 차트 선택`} aria-pressed={market.id === selectedId} className="market-symbol-button">
            <span className="market-list-symbol"><strong>{market.symbol}USDT</strong><span>{market.name}</span></span>
            <span className="market-list-price tabular-nums"><span>{formatDecimal(ticker?.markPrice)}</span><span data-trend={pnlTrend(ticker?.changePercent24h ?? null)}>{ticker?.changePercent24h == null ? "—" : `${formatDecimal(ticker.changePercent24h)}%`}</span></span>
          </button>
        ); })}
    </div>
  );
}
