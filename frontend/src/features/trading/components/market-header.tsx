import { previewMarket, previewSymbols } from "../preview-data";
import type { TradingSymbol } from "../market/catalog";

export function MarketHeader({ symbol }: { symbol: TradingSymbol | null }) {
  const market = previewSymbols.find((entry) => entry.symbol === symbol?.symbol) ?? previewSymbols[0];
  const isBtc = market.symbol === "BTC";
  return (
    <section aria-labelledby="market-heading" aria-describedby="preview-notice" className="market-summary trading-section">
      <header className="market-summary-header">
        <a href="#symbols-heading" aria-label="차트 종목 선택으로 이동" className="market-back">
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="m14 6-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </a>
        <div className="market-symbol">
          <h2 id="market-heading">{market.symbol}USDT</h2>
          <p>무기한 선물 <span>Demo Trading</span></p>
        </div>
        <div className="market-tools" role="group" aria-label="거래 도구 (미지원)">
          <button type="button" disabled aria-label="즐겨찾기 (미지원)"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9L12 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg></button>
          <button type="button" disabled aria-label="더 보기 (미지원)"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg></button>
        </div>
      </header>
      <div className="market-summary-body">
        <div className="market-primary-price tabular-nums">
          <p className="market-price-label">{isBtc ? "Mark Price" : "참고 가격"} <span>예시</span></p>
          <p className="market-price" data-trend={market.trend}>{isBtc ? previewMarket.markPrice : market.price} <span>USDT</span></p>
          <p className="market-change" data-trend={market.trend}>24h {market.change} <span>예시</span></p>
        </div>
        <dl className="market-statistics tabular-nums">
          <div><dt>24h 최고 · 예시</dt><dd>{isBtc ? previewMarket.high : "—"}</dd></div>
          <div><dt>24h 최저 · 예시</dt><dd>{isBtc ? previewMarket.low : "—"}</dd></div>
          <div><dt>24h 거래대금 · 예시</dt><dd>{isBtc ? previewMarket.volume : "—"}</dd></div>
        </dl>
      </div>
    </section>
  );
}
