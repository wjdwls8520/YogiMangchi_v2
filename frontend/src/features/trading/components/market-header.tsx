import type { TradingSymbol } from "../market/catalog";
import { freshMarkPrice, type SelectedMarket } from "../market/selected-market";
import { formatDecimal, pnlTrend } from "../api/account";
import type { MarketTicker } from "../market/tickers";
import { formatMarketPrice } from "../market/price-format";

export function MarketHeader({ symbol, market: feed, ticker }: { symbol: TradingSymbol | null; market: SelectedMarket; ticker?: MarketTicker }) {
  const markPrice = freshMarkPrice(feed);
  return (
    <section aria-labelledby="market-heading" aria-describedby="preview-notice" className="market-summary trading-section">
      <header className="market-summary-header">
        <div className="market-symbol">
          <h2 id="market-heading">{symbol ? `${symbol.symbol}${symbol.quoteAsset}` : "종목 선택"}</h2>
          <p>무기한 선물 <span>Demo Trading</span></p>
        </div>
        <div className="market-tools" role="group" aria-label="거래 도구 (미지원)">
          <button type="button" disabled aria-label="즐겨찾기 (미지원)"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9L12 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg></button>
          <button type="button" disabled aria-label="더 보기 (미지원)"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg></button>
        </div>
      </header>
      <div className="market-summary-body">
        <div className="market-primary-price tabular-nums">
          <p className="market-price-label">Mark Price <span>{markPrice ? "실시간" : feed.state === "UNAVAILABLE" || feed.state === "RECONNECTING" ? "시세 이용 불가" : "현재 시세 확인 중"}</span></p>
          <p className="market-price">{formatMarketPrice(markPrice?.decimal, symbol?.priceTickSize)} <span>USDT</span></p>
          <p className="market-change" data-trend={pnlTrend(ticker?.changePercent24h ?? null)}>24h {ticker?.changePercent24h == null ? "—" : `${formatDecimal(ticker.changePercent24h)}%`}</p>
        </div>
        <dl className="market-statistics tabular-nums">
          <div><dt>24h 최고</dt><dd>{formatMarketPrice(ticker?.highPrice24h, symbol?.priceTickSize)}</dd></div>
          <div><dt>24h 최저</dt><dd>{formatMarketPrice(ticker?.lowPrice24h, symbol?.priceTickSize)}</dd></div>
          <div><dt>24h 거래대금 · USDT</dt><dd>{formatDecimal(ticker?.quoteVolume24h)}</dd></div>
        </dl>
      </div>
    </section>
  );
}
