import type { TradingSymbol } from "../market/catalog";
import { freshMarkPrice, type SelectedMarket } from "../market/selected-market";
import { formatDecimal, pnlTrend } from "../api/account";
import type { MarketTicker } from "../market/tickers";
import { formatMarketPrice } from "../market/price-format";

export function MarketHeader({ symbol, market: feed, ticker }: { symbol: TradingSymbol | null; market: SelectedMarket; ticker?: MarketTicker }) {
  const markPrice = freshMarkPrice(feed);
  return (
    <section aria-labelledby="market-heading" className="market-summary trading-section">
      <header className="market-summary-header">
        <div className="market-symbol">
          <h2 id="market-heading">{symbol ? `${symbol.symbol}${symbol.quoteAsset}` : "종목 선택"}</h2>
          <p>Perpetual</p>
        </div>
      </header>
      <div className="market-summary-body">
        <div className="market-primary-price tabular-nums">
          <p className="market-price-label">Mark Price {!markPrice && <span>{feed.state === "UNAVAILABLE" || feed.state === "RECONNECTING" ? "시세 이용 불가" : "수신 대기"}</span>}</p>
          <p className="market-price" data-trend={pnlTrend(ticker?.changePercent24h ?? null)}>{formatMarketPrice(markPrice?.decimal, symbol?.priceTickSize)} <span>USDT</span></p>
        </div>
        <div className="market-change-block"><p className="market-price-label">24h 변동률</p><p className="market-change" data-trend={pnlTrend(ticker?.changePercent24h ?? null)}>{ticker?.changePercent24h == null ? "—" : `${formatDecimal(ticker.changePercent24h)}%`}</p></div>
        <dl className="market-statistics tabular-nums">
          <div><dt>24h 최고</dt><dd>{formatMarketPrice(ticker?.highPrice24h, symbol?.priceTickSize)}</dd></div>
          <div><dt>24h 최저</dt><dd>{formatMarketPrice(ticker?.lowPrice24h, symbol?.priceTickSize)}</dd></div>
          <div><dt>24h 거래대금 · USDT</dt><dd>{formatDecimal(ticker?.quoteVolume24h)}</dd></div>
        </dl>
      </div>
    </section>
  );
}
