import { previewSymbols } from "../preview-data";

export function SymbolSelector() {
  return (
    <section aria-labelledby="symbols-heading" className="border-x border-b border-slate-200 bg-white">
      <h2 id="symbols-heading" className="sr-only">종목 선택</h2>
      <div role="group" aria-label="거래 종목 (미리보기)" className="grid grid-cols-5">
        {previewSymbols.map((market) => (
          <button key={market.symbol} type="button" disabled aria-pressed={market.symbol === "BTC"} className="flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 border-b-2 border-b-transparent border-r border-r-slate-100 px-1 py-3 text-xs tabular-nums last:border-r-0 aria-pressed:border-b-brand-600 aria-pressed:bg-brand-50 sm:flex-row sm:flex-wrap sm:gap-x-3 sm:gap-y-1 sm:px-3 md:justify-between">
            <span className="font-semibold">{market.symbol} <span className="hidden font-normal text-slate-400 xl:inline">/ USDT</span></span>
            <span className="hidden w-full text-left font-medium md:block md:order-3">{market.price}</span>
            <span data-trend={market.trend}><span className="hidden lg:inline">{market.trend === "up" ? "↗" : "↘"} </span>{market.change}</span>
            <span className="sr-only">{market.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
