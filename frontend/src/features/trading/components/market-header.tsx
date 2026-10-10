import { previewMarket } from "../preview-data";

export function MarketHeader() {
  return (
    <section aria-labelledby="market-heading" aria-describedby="preview-notice" className="trading-section grid gap-4 px-4 py-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-center lg:gap-6">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-2xl font-semibold text-amber-700">₿</span>
        <div>
          <h2 id="market-heading" className="whitespace-nowrap text-base font-bold tracking-tight">{previewMarket.symbol} <span className="font-normal text-slate-400">/</span> {previewMarket.quote}</h2>
          <p className="mt-1 whitespace-nowrap text-xs text-slate-500">{previewMarket.name} · 무기한 선물</p>
        </div>
      </div>
      <div className="tabular-nums">
        <p className="whitespace-nowrap text-3xl font-semibold tracking-tight"><span className="sr-only">현재 가격 </span>{previewMarket.price} <span className="text-xs font-medium text-slate-500 lg:hidden">USDT</span></p>
        <p className="mt-1.5 text-xs font-medium text-gain"><span className="sr-only">24시간 상승 </span>↗ {previewMarket.change} <span className="ml-1 font-normal">({previewMarket.changeAmount})</span></p>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-100 pt-4 text-xs tabular-nums sm:col-span-2 sm:grid-cols-4 lg:col-span-3 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0 [&_dd]:mt-1.5 [&_dd]:font-medium [&_dt]:text-slate-500">
        <div><dt>Mark Price</dt><dd>{previewMarket.markPrice}</dd></div>
        <div><dt>24h 최고</dt><dd>{previewMarket.high}</dd></div>
        <div><dt>24h 최저</dt><dd>{previewMarket.low}</dd></div>
        <div><dt>24h 거래대금</dt><dd>{previewMarket.volume} USDT</dd></div>
      </dl>
    </section>
  );
}
