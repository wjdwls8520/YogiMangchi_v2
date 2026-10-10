import { previewAccount } from "../preview-data";
import { OrderChoices, OrderInput } from "./order-controls";

export function OrderPanel() {
  return (
    <section aria-labelledby="order-heading" aria-describedby="order-preview-note">
      <header>
        <h2 id="order-heading">주문</h2>
        <span>BTC / USDT</span>
      </header>
      <div>
        <OrderChoices legend="주문 유형" name="order-type" selected="market" choices={[
          { value: "market", label: "Market" }, { value: "limit", label: "Limit" },
        ]} />
        <OrderChoices legend="포지션 방향" name="position-side" selected="long" choices={[
          { value: "long", label: "↗ Long" }, { value: "short", label: "↘ Short" },
        ]} />
        <div>
          <label htmlFor="leverage">레버리지</label>
          <select id="leverage" name="leverage" defaultValue="10" disabled>
            {["1", "2", "5", "10", "20"].map((value) => <option key={value} value={value}>{value}×</option>)}
          </select>
        </div>
        <dl><div><dt>사용 가능</dt><dd>{previewAccount.available} USDT</dd></div></dl>
        <OrderInput id="order-quantity" label="주문 수량" unit="BTC" placeholder="0.000" />
        <OrderInput id="limit-price" label="지정가" unit="USDT" placeholder="가격 입력" hint="Limit 주문 시 입력" />
        <div>
          <label htmlFor="order-ratio">주문 비율</label>
          <input id="order-ratio" name="order-ratio" type="range" min="0" max="100" step="25" defaultValue="25" disabled />
          <OrderChoices legend="비율 선택" name="ratio-preset" selected="25" choices={[
            { value: "25", label: "25%" }, { value: "50", label: "50%" },
            { value: "75", label: "75%" }, { value: "100", label: "100%" },
          ]} />
        </div>
        <dl>
          <div><dt>예상 주문 금액</dt><dd>— USDT</dd></div>
          <div><dt>예상 증거금</dt><dd>— USDT</dd></div>
        </dl>
        <button type="button" disabled>Long 주문</button>
        <p id="order-preview-note">미리보기에서는 주문할 수 없습니다.</p>
      </div>
    </section>
  );
}
