import { previewSymbols } from "../preview-data";

export function SymbolSelector() {
  return (
    <section aria-labelledby="symbols-heading">
      <h2 id="symbols-heading" className="sr-only">종목 선택</h2>
      <div role="group" aria-label="거래 종목 (미리보기)">
        {previewSymbols.map((market) => (
          <button key={market.symbol} type="button" disabled aria-pressed={market.symbol === "BTC"}>
            <span>{market.symbol} <span>/ USDT</span></span>
            <span>{market.price}</span>
            <span data-trend={market.trend}>{market.trend === "up" ? "↗" : "↘"} {market.change}</span>
            <span className="sr-only">{market.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
