import { previewSymbols } from "../preview-data";
import type { TradingSymbol } from "../market/catalog";

export function SymbolSelector({ symbols, selectedId, onSelect }: {
  symbols: readonly TradingSymbol[]; selectedId: number | null; onSelect: (id: number) => void;
}) {
  return (
    <section aria-labelledby="symbols-heading" className="market-selector">
      <h2 id="symbols-heading" tabIndex={-1} className="sr-only">차트 종목 선택</h2>
      <div role="group" aria-label="차트 종목 선택 (가격과 등락률은 예시)" className="grid grid-cols-5">
        {previewSymbols.map((market) => {
          const available = symbols.find((entry) => entry.symbol === market.symbol);
          return (
          <button key={market.symbol} type="button" disabled={!available} onClick={() => available && onSelect(available.id)} aria-label={`${market.symbol} 차트 선택`} aria-pressed={!!available && available.id === selectedId} className="market-symbol-button">
            <span className="font-semibold">{market.symbol}</span>
            <span className="sr-only">가격 {market.price} · 등락률 {market.change} · 예시</span>
            <span className="sr-only">{market.name}</span>
          </button>
        ); })}
      </div>
    </section>
  );
}
