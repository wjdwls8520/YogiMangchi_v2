import { previewSymbols } from "../preview-data";
import type { TradingSymbol } from "../market/catalog";

export function SymbolSelector({ symbols, selectedId, onSelect }: {
  symbols: readonly TradingSymbol[]; selectedId: number | null; onSelect: (id: number) => void;
}) {
  return (
    <div role="group" aria-label="차트 종목 선택 (가격과 등락률은 예시)" className="market-selector">
        {previewSymbols.map((market) => {
          const available = symbols.find((entry) => entry.symbol === market.symbol);
          return (
          <button key={market.symbol} type="button" disabled={!available} onClick={() => available && onSelect(available.id)} aria-label={`${market.symbol} 차트 선택`} aria-pressed={!!available && available.id === selectedId} className="market-symbol-button">
            <span className="market-list-symbol"><strong>{market.symbol}USDT</strong><span>{market.name}</span></span>
            <span className="market-list-price tabular-nums"><span>{market.price}</span><span data-trend={market.trend}>{market.change}</span></span>
            {!available && <span className="market-list-unavailable">이용 불가</span>}
          </button>
        ); })}
    </div>
  );
}
