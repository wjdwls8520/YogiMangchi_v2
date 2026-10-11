import { previewAccount } from "../preview-data";
import { OrderChoices, OrderInput } from "./order-controls";

export function OrderPanel() {
  return (
    <section aria-labelledby="order-heading" aria-describedby="order-preview-note" className="order-panel trading-section">
      <header className="section-heading">
        <h2 id="order-heading" className="section-title">주문</h2>
        <span className="preview-label">예시 주문</span>
      </header>
      <div className="order-panel-body space-y-3 p-4 lg:space-y-2">
        <dl className="order-wallet"><div><dt>사용 가능 · 예시</dt><dd>{previewAccount.available} <span>USDT</span></dd></div></dl>
        <div className="order-actions" role="group" aria-label="포지션 진입 (미리보기)">
          <button type="button" disabled data-side="LONG">↗ Long <span>매수</span></button>
          <button type="button" disabled data-side="SHORT">↘ Short <span>매도</span></button>
        </div>
        <details className="order-settings" open>
          <summary>주문 설정 <span>Market · 10× · 미지원</span></summary>
          <div className="order-settings-fields">
            <OrderChoices legend="주문 유형" name="order-type" selected="market" choices={[
              { value: "market", label: "Market" }, { value: "limit", label: "Limit" },
            ]} />
            <OrderChoices legend="포지션 방향" name="position-side" selected="long" choices={[
              { value: "long", label: "↗ Long" }, { value: "short", label: "↘ Short" },
            ]} />
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="leverage" className="text-xs font-medium text-slate-600">레버리지</label>
              <select id="leverage" name="leverage" defaultValue="10" disabled className="min-h-11 min-w-24 rounded-sm border border-slate-200 bg-slate-50 px-3 text-sm font-semibold tabular-nums lg:min-h-9">
                {["1", "2", "5", "10", "20"].map((value) => <option key={value} value={value}>{value}×</option>)}
              </select>
            </div>
            <OrderInput id="order-quantity" label="주문 수량" unit="BTC · 예시" placeholder="0.000" />
            <OrderInput id="limit-price" label="지정가" unit="USDT" placeholder="가격 입력" hint="Limit 주문 시 입력" />
            <div>
              <label htmlFor="order-ratio" className="field-label">주문 비율 <span className="float-right font-semibold tabular-nums text-brand-700">25%</span></label>
              <input id="order-ratio" name="order-ratio" type="range" min="0" max="100" step="25" defaultValue="25" disabled className="mb-3 h-6 w-full accent-brand-600" />
              <OrderChoices legend="비율 선택" name="ratio-preset" selected="25" choices={[
                { value: "25", label: "25%" }, { value: "50", label: "50%" },
                { value: "75", label: "75%" }, { value: "100", label: "100%" },
              ]} />
            </div>
            <dl className="space-y-2 border-t border-slate-100 pt-4 text-xs lg:pt-3 [&_div]:flex [&_div]:justify-between [&_dt]:text-slate-500 [&_dd]:font-medium [&_dd]:tabular-nums">
              <div><dt>예상 주문 금액</dt><dd>— USDT</dd></div>
              <div><dt>예상 증거금</dt><dd>— USDT</dd></div>
            </dl>
          </div>
        </details>
        <p id="order-preview-note" className="text-center text-xs leading-relaxed text-slate-500">미리보기에서는 주문할 수 없습니다.</p>
      </div>
    </section>
  );
}
