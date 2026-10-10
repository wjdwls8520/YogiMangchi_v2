import { previewMarket } from "../preview-data";

export function MarketHeader() {
  return (
    <section aria-labelledby="market-heading" aria-describedby="preview-notice">
      <div>
        <span aria-hidden="true">₿</span>
        <div>
          <h2 id="market-heading">{previewMarket.symbol} / {previewMarket.quote}</h2>
          <p>{previewMarket.name} · 무기한 선물</p>
        </div>
      </div>
      <div>
        <p><span className="sr-only">현재 가격 </span>{previewMarket.price} <span>USDT</span></p>
        <p><span className="sr-only">24시간 상승 </span>↗ {previewMarket.change} <span>({previewMarket.changeAmount})</span></p>
      </div>
      <dl>
        <div><dt>Mark Price</dt><dd>{previewMarket.markPrice}</dd></div>
        <div><dt>24h 최고</dt><dd>{previewMarket.high}</dd></div>
        <div><dt>24h 최저</dt><dd>{previewMarket.low}</dd></div>
        <div><dt>24h 거래대금</dt><dd>{previewMarket.volume} USDT</dd></div>
      </dl>
    </section>
  );
}
