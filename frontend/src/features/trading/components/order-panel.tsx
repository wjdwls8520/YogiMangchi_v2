"use client";

import { useState } from "react";
import { AccountWallet } from "./account-wallet";
import { OrderChoices, OrderInput } from "./order-controls";
import { useSelectedMarket } from "./selected-market-provider";
import { useGuestSession } from "./trading-data-provider";
import { freshMarkPrice } from "../market/selected-market";
import { useTradingSummary } from "../api/queries";
import { useTradingMutation } from "../api/mutations";
import { estimatedOrder, ratioQuantity, validLimitPrice, validQuantity } from "../api/order-input";
import { formatDecimal } from "../api/account";
import type { TradingOrder } from "../api/orders";

type Form = { symbolId: number | null; type: "MARKET" | "LIMIT"; side: "LONG" | "SHORT"; leverage: number; quantity: string; limitPrice: string; ratio: number };
export function OrderPanel() {
  const { symbol, market } = useSelectedMarket();
  const { snapshot } = useGuestSession();
  const account = useTradingSummary();
  const action = useTradingMutation();
  const [stored, setForm] = useState<Form>({ symbolId: null, type: "MARKET", side: "LONG", leverage: 10, quantity: "", limitPrice: "", ratio: 0 });
  const [result, setResult] = useState<{ order: TradingOrder; accountId: number | null } | null>(null);
  const form = stored.symbolId === symbol?.id ? stored : { ...stored, symbolId: symbol?.id ?? null, quantity: "", limitPrice: "", ratio: 0 };
  const mark = freshMarkPrice(market);
  const ready = snapshot.phase === "ready" && account.data?.status === "ACTIVE" && !!symbol && !!mark;
  const locked = action.pending || action.unconfirmed || snapshot.phase !== "ready";
  const price = form.type === "LIMIT" ? form.limitPrice.trim() : mark?.decimal ?? "";
  const quantity = form.quantity.trim();
  const valid = validQuantity(quantity) && (form.type === "MARKET" || validLimitPrice(price));
  const estimate = estimatedOrder(quantity, price, form.leverage);
  function update(values: Partial<Form>) { setForm({ ...form, ...values }); setResult(null); }
  function selectRatio(percent: number) {
    update({ ratio: percent, quantity: percent === 0 ? "" : ratioQuantity(account.data?.wallet.availableBalance, price, form.leverage, percent) });
  }
  function complete(order: TradingOrder | null) {
    if (!order) return;
    setResult({ order, accountId: snapshot.accountId });
    setForm((current) => ({ ...current, quantity: "", ratio: 0 }));
  }
  async function submit(side: "LONG" | "SHORT") {
    if (!ready || !symbol || !valid || locked) return;
    update({ side });
    complete(await action.submit({ kind: "open", tradingSymbolId: symbol.id, type: form.type, side, quantity,
      leverage: form.leverage, ...(form.type === "LIMIT" ? { limitPrice: price } : {}) }));
  }
  return <section aria-labelledby="order-heading" aria-describedby="order-preview-note" className="order-panel trading-section">
    <header className="section-heading"><h2 id="order-heading" className="section-title">주문</h2><span className="preview-label">Guest 모의투자</span></header>
    <form className="order-panel-body" onSubmit={(event) => { event.preventDefault(); void submit(form.side); }}>
      <AccountWallet />
      <details className="order-settings" open>
        <summary>주문 설정 <span>{form.type} · {form.leverage}× · {symbol?.displaySymbol ?? "종목 선택"}</span></summary>
        <div className="order-settings-fields">
          <OrderChoices legend="주문 유형" name="order-type" selected={form.type} disabled={locked} onChange={(value) => { if (value === "MARKET" || value === "LIMIT") update({ type: value, ratio: 0 }); }} choices={[{ value: "MARKET", label: "Market" }, { value: "LIMIT", label: "Limit" }]} />
          <OrderChoices legend="포지션 방향" name="position-side" selected={form.side} disabled={locked} onChange={(value) => { if (value === "LONG" || value === "SHORT") update({ side: value }); }} choices={[{ value: "LONG", label: "↗ Long" }, { value: "SHORT", label: "↘ Short" }]} />
          <div className="order-leverage"><label htmlFor="leverage" className="text-trade-meta font-medium text-slate-500">레버리지</label>
            <select id="leverage" value={form.leverage} disabled={locked} onChange={(event) => update({ leverage: Number(event.target.value), ratio: 0 })} className="order-leverage-input">
              {Array.from({ length: 20 }, (_, i) => i + 1).map((value) => <option key={value} value={value}>{value}×</option>)}
            </select>
          </div>
          <OrderInput id="order-quantity" label="주문 수량" unit={symbol?.symbol ?? "—"} placeholder="0.000" value={form.quantity} disabled={locked || !symbol} onChange={(value) => update({ quantity: value, ratio: 0 })} hint="양수 · 소수점 최대 8자리" />
          <OrderInput id="limit-price" label="지정가" unit="USDT" placeholder="가격 입력" value={form.limitPrice} disabled={locked || form.type !== "LIMIT"} onChange={(value) => update({ limitPrice: value, ratio: 0 })} hint={form.type === "LIMIT" ? "양수 · 소수점 최대 18자리" : "Market는 서버 Mark Price로 체결"} />
          <div className="order-ratio">
            <label htmlFor="order-ratio" className="field-label">참고 자산 비율 <span className="float-right font-semibold tabular-nums text-brand-700">{form.ratio}%</span></label>
            <input id="order-ratio" type="range" min="0" max="100" step="25" value={form.ratio} disabled={locked || !ready || !validLimitPrice(price)} onChange={(event) => selectRatio(Number(event.target.value))} className="h-8 w-full accent-brand-600" />
            <OrderChoices legend="비율 선택" name="ratio-preset" selected={String(form.ratio)} disabled={locked || !ready || !validLimitPrice(price)} onChange={(value) => selectRatio(Number(value))} choices={[25, 50, 75, 100].map((value) => ({ value: String(value), label: `${value}%` }))} />
          </div>
          <dl className="order-estimates"><div><dt>참고 주문 금액</dt><dd>{formatDecimal(estimate?.notional)} USDT</dd></div><div><dt>참고 증거금</dt><dd>{formatDecimal(estimate?.margin)} USDT</dd></div></dl>
        </div>
      </details>
      {form.quantity && !validQuantity(quantity) && <p role="alert" className="order-input-hint">수량은 0보다 커야 하며 소수점은 8자리까지 지원합니다.</p>}
      {form.type === "LIMIT" && form.limitPrice && !validLimitPrice(price) && <p role="alert" className="order-input-hint">양수 지정가를 입력해 주세요. 소수점은 18자리까지 지원합니다.</p>}
      {!ready && <p role="status" className="order-input-hint">거래할 계정과 선택 종목의 최신 시세를 확인하는 중입니다.</p>}
      <div className="order-actions" role="group" aria-label="포지션 진입">
        <button type="button" disabled={!ready || !valid || locked} onClick={() => void submit("LONG")} data-side="LONG">↗ Long <span>{action.pending ? "처리 중" : "매수"}</span></button>
        <button type="button" disabled={!ready || !valid || locked} onClick={() => void submit("SHORT")} data-side="SHORT">↘ Short <span>{action.pending ? "처리 중" : "매도"}</span></button>
      </div>
      {action.error && <p role="alert" className="order-input-hint">{action.error}</p>}
      {action.unconfirmed && <button type="button" className="account-refresh" disabled={action.pending} onClick={() => void action.retry().then(complete)}>같은 주문 결과 확인</button>}
      {result && result.accountId === snapshot.accountId && <p role="status" className="order-input-hint">주문 #{result.order.orderId} · {result.order.status}{result.order.fill ? ` · 체결가 ${formatDecimal(result.order.fill.price)} USDT` : ""}</p>}
      <p id="order-preview-note" className="order-preview-note">실제 자금을 사용하지 않습니다. 참고 금액은 체결 결과와 다를 수 있으며 서버가 체결가·증거금·손익을 결정합니다.</p>
    </form>
  </section>;
}
