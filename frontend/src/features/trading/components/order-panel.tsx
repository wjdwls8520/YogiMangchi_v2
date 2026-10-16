"use client";

import { useState } from "react";
import { AccountWallet } from "./account-wallet";
import { OrderChoices, OrderInput } from "./order-controls";
import { useSelectedMarket } from "./selected-market-provider";
import { useGuestSession } from "./trading-data-provider";
import { freshMarkPrice } from "../market/selected-market";
import { useTradingSummary } from "../api/queries";
import { useTradingMutation } from "../api/mutations";
import { estimatedOrder, ratioQuantity, validLimitPrice, validQuantity, validSizingPrice } from "../api/order-input";
import { formForSymbol, marketableLimitIssue, preflightOrder, selectBookPrice, type OpenForm, type OrderIssue } from "../api/order-preflight";
import { formatDecimal } from "../api/account";
import type { TradingOrder } from "../api/orders";
import { formatMarketPrice } from "../market/price-format";
import { OrderBookPanel } from "./order-book-panel";
import { GuestStartPrompt } from "./guest-access";

type Form = OpenForm & { identity: string };
export function OrderPanel() {
  const { symbol, market, orderBook } = useSelectedMarket();
  const { snapshot } = useGuestSession();
  const account = useTradingSummary();
  const identity = `${snapshot.accountId}:${snapshot.generation}`;
  const [stored, setForm] = useState<Form>({ identity, symbolId: null, type: "MARKET", side: "LONG", leverage: 10, quantity: "", limitPrice: "", ratio: 0 });
  const [result, setResult] = useState<{ order: TradingOrder; identity: string } | null>(null);
  const [serverWarning, setServerWarning] = useState<{ side: OpenForm["side"]; issue: OrderIssue } | null>(null);
  const [entryView, setEntryView] = useState<"order" | "book">("order");
  const switched = stored.symbolId !== (symbol?.id ?? null) || stored.identity !== identity;
  const form: Form = switched ? { ...formForSymbol(stored, symbol?.id ?? null), identity, quantity: "", limitPrice: "", ratio: 0 } : stored;
  // Commit the reset, so switching A -> B -> A cannot resurrect A's old inputs.
  if (switched) { setForm(form); setResult(null); setServerWarning(null); }
  const action = useTradingMutation((issue, command, requestSession) => {
    if (command.kind !== "open" || command.tradingSymbolId !== symbol?.id || `${requestSession.accountId}:${requestSession.generation}` !== identity
      || command.quantity !== form.quantity.trim() || command.type !== form.type || command.leverage !== form.leverage
      || (command.type === "LIMIT" && command.limitPrice !== form.limitPrice.trim())) return;
    setServerWarning({ side: command.side, issue });
    window.alert(issue.message);
  });
  const mark = freshMarkPrice(market);
  const ready = snapshot.phase === "ready" && account.data?.status === "ACTIVE" && !!symbol && !!mark;
  const locked = action.pending || action.unconfirmed || snapshot.phase !== "ready";
  const price = form.type === "LIMIT" ? form.limitPrice.trim() : mark?.decimal ?? "";
  const quantity = form.quantity.trim();
  const valid = validQuantity(quantity) && (form.type === "MARKET" || validLimitPrice(price));
  const canSize = ready && account.data?.wallet.availableBalance != null && (form.type === "LIMIT" ? validLimitPrice(price) : validSizingPrice(price));
  const estimate = estimatedOrder(quantity, price, form.leverage);
  function update(values: Partial<OpenForm>) { setForm({ ...form, ...values }); setResult(null); setServerWarning(null); action.clearError(); }
  function selectRatio(percent: number) {
    update({ ratio: percent, quantity: percent === 0 ? "" : ratioQuantity(account.data?.wallet.availableBalance, price, form.leverage, percent) });
  }
  function complete(order: TradingOrder | null) {
    if (!order) return;
    setResult({ order, identity });
    setForm((current) => current.identity === identity && current.symbolId === order.tradingSymbolId ? { ...current, quantity: "", ratio: 0 } : current);
  }
  async function submit(side: "LONG" | "SHORT") {
    if (locked) return;
    update({ side });
    const issue = preflightOrder(form, side, ready, freshMarkPrice(market)?.decimal, account.data?.wallet.availableBalance);
    if (issue) { setServerWarning({ side, issue }); window.alert(issue.message); return; }
    if (!symbol) return;
    complete(await action.submit({ kind: "open", tradingSymbolId: symbol.id, type: form.type, side, quantity,
      leverage: form.leverage, ...(form.type === "LIMIT" ? { limitPrice: price } : {}) }));
  }
  function selectPrice(price: string) {
    if (action.pending || action.unconfirmed) return;
    update(selectBookPrice(form, price));
    setEntryView("order");
    requestAnimationFrame(() => document.getElementById("limit-price")?.focus());
  }
  function warning(side: OpenForm["side"]) {
    if (serverWarning?.side === side) return serverWarning.issue;
    const relation = form.type === "LIMIT" ? marketableLimitIssue(side, price, mark?.decimal) : null;
    if (relation) return relation;
    const check = valid ? preflightOrder(form, side, ready, mark?.decimal, account.data?.wallet.availableBalance) : null;
    return check?.kind === "balance" ? check : null;
  }
  return <section aria-labelledby="order-heading" aria-describedby={snapshot.phase === "ready" ? "order-preview-note" : undefined} className="order-panel trading-section">
    <header className="section-heading"><h2 id="order-heading" className="section-title">주문</h2><span className="preview-label">{snapshot.phase === "ready" ? "Guest 모의투자" : "모의투자"}</span></header>
    <div className="order-entry-navigation" role="group" aria-label="주문 패널 보기">
      <button type="button" aria-pressed={entryView === "order"} onClick={() => setEntryView("order")}>주문 입력</button>
      <button type="button" aria-pressed={entryView === "book"} onClick={() => setEntryView("book")}>호가</button>
    </div>
    <div className="order-entry" data-entry-view={entryView}>
    {snapshot.phase !== "ready" ? <div className="order-panel-body"><GuestStartPrompt /></div> : <form className="order-panel-body" onSubmit={(event) => { event.preventDefault(); void submit(form.side); }}>
      <AccountWallet />
      <details className="order-settings" open>
        <summary>주문 설정 <span>{form.type} · {form.leverage}× · {symbol?.displaySymbol ?? "종목 선택"}</span></summary>
        <div className="order-settings-fields" data-order-type={form.type}>
          <OrderChoices legend="주문 유형" name="order-type" selected={form.type} disabled={locked} onChange={(value) => { if (value === "MARKET" || value === "LIMIT") update({ type: value, ratio: 0 }); }} choices={[{ value: "MARKET", label: "Market" }, { value: "LIMIT", label: "Limit" }]} />
          <OrderChoices legend="포지션 방향" name="position-side" selected={form.side} disabled={locked} onChange={(value) => { if (value === "LONG" || value === "SHORT") update({ side: value }); }} choices={[{ value: "LONG", label: "↗ Long" }, { value: "SHORT", label: "↘ Short" }]} />
          <div className="order-leverage"><label htmlFor="leverage" className="text-trade-meta font-medium text-slate-500">레버리지</label>
            <select id="leverage" value={form.leverage} disabled={locked} onChange={(event) => update({ leverage: Number(event.target.value), ratio: 0 })} className="order-leverage-input">
              {Array.from({ length: 20 }, (_, i) => i + 1).map((value) => <option key={value} value={value}>{value}×</option>)}
            </select>
          </div>
          <OrderInput id="order-quantity" label="주문 수량" unit={symbol?.symbol ?? "—"} placeholder="0.000" value={form.quantity} disabled={locked || !symbol} onChange={(value) => update({ quantity: value, ratio: 0 })} hint="양수 · 소수점 최대 8자리" />
          {form.type === "LIMIT" && <OrderInput id="limit-price" label="지정가" unit="USDT" placeholder="가격 입력" value={form.limitPrice} disabled={locked} onChange={(value) => update({ limitPrice: value, ratio: 0 })} hint="양수 · 소수점 최대 18자리" />}
          <div className="order-ratio">
            <label htmlFor="order-ratio" className="field-label">참고 자산 비율 <span className="float-right font-semibold tabular-nums text-brand-700">{form.ratio}%</span></label>
            <input id="order-ratio" type="range" min="0" max="100" step="25" value={form.ratio} disabled={locked || !canSize} onChange={(event) => selectRatio(Number(event.target.value))} className="h-8 w-full accent-brand-600" />
            <OrderChoices legend="비율 선택" name="ratio-preset" selected={String(form.ratio)} disabled={locked || !canSize} onChange={(value) => selectRatio(Number(value))} choices={[25, 50, 75, 100].map((value) => ({ value: String(value), label: `${value}%` }))} />
            <p className="order-input-hint">비율은 선택 순간의 잔액·주문가격으로 수량을 채웁니다. 이후 시세가 움직여도 수량은 유지됩니다.</p>
          </div>
          <dl className="order-estimates"><div><dt>참고 주문 금액</dt><dd>{formatDecimal(estimate?.notional)} USDT</dd></div><div><dt>참고 증거금</dt><dd>{formatDecimal(estimate?.margin)} USDT</dd></div></dl>
        </div>
      </details>
      {form.quantity && !validQuantity(quantity) && <p role="alert" className="order-input-hint">수량은 0보다 커야 하며 소수점은 8자리까지 지원합니다.</p>}
      {form.type === "LIMIT" && form.limitPrice && !validLimitPrice(price) && <p role="alert" className="order-input-hint">양수 지정가를 입력해 주세요. 소수점은 18자리까지 지원합니다.</p>}
      {!ready && <p role="status" className="order-input-hint">거래할 계정과 선택 종목의 최신 시세를 확인하는 중입니다.</p>}
      <div className="order-actions" role="group" aria-label="포지션 진입">
        {(["LONG", "SHORT"] as const).map((side) => <div key={side}>
          <button type="button" disabled={!ready || !valid || locked} onClick={() => void submit(side)} data-side={side}>{side === "LONG" ? "↗ Long" : "↘ Short"} <span>{action.pending ? "처리 중" : side === "LONG" ? "매수" : "매도"}</span></button>
          {warning(side) && <p role="alert" className="order-warning" data-warning-side={side}>{warning(side)?.message}</p>}
        </div>)}
      </div>
      {action.error && !serverWarning && (action.command?.kind !== "open" || action.command.tradingSymbolId === symbol?.id) && <p role="alert" className="order-warning">{action.error}</p>}
      {action.unconfirmed && <button type="button" className="account-refresh" disabled={action.pending} onClick={() => void action.retry().then(complete)}>같은 주문 결과 확인</button>}
      {result && result.identity === identity && result.order.tradingSymbolId === symbol?.id && <p role="status" className="order-input-hint">주문 #{result.order.orderId} · {result.order.status}{result.order.fill ? ` · 체결가 ${formatMarketPrice(result.order.fill.price, symbol.priceTickSize)} USDT` : ""}</p>}
      <p id="order-preview-note" className="order-preview-note">실제 자금을 사용하지 않습니다. 참고 금액은 체결 결과와 다를 수 있으며 서버가 체결가·증거금·손익을 결정합니다.</p>
    </form>}
    <OrderBookPanel symbol={symbol} book={orderBook} mark={mark?.decimal} disabled={action.pending || action.unconfirmed} onSelectPrice={selectPrice} />
    </div>
  </section>;
}
