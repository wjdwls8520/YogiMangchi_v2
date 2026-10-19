"use client";

import { useState } from "react";
import { AccountWallet } from "./account-wallet";
import { OrderChoices, OrderInput, OrderLeverage } from "./order-controls";
import { useSelectedMarket } from "./selected-market-provider";
import { useGuestSession } from "./trading-data-provider";
import { freshMarkPrice } from "../market/selected-market";
import { useTradingSummary } from "../api/queries";
import { useSymbolLeverage } from "../api/leverage";
import { useTradingMutation } from "../api/mutations";
import { estimatedOrder, validLimitPrice, validQuantity, validSizingPrice } from "../api/order-input";
import { formForSymbol, formForSide, formForBookPrice, ratioInputQuantity, marketableLimitIssue, preflightOrder, sizingUnavailable, type OpenForm, type OrderIssue } from "../api/order-preflight";
import { formatDecimal } from "../api/account";
import type { TradingOrder } from "../api/orders";
import { formatMarketPrice } from "../market/price-format";
import { GuestStartPrompt } from "./guest-access";
import { WalletOverview } from "./wallet-overview";
import { CloseOrderPanel } from "./close-order-panel";
import { TradingNavigation } from "./trading-navigation";

type Form = OpenForm & { identity: string };
export function OrderPanel() {
  const [intent,setIntent]=useState<"open"|"close">("open");
  const {snapshot}=useGuestSession(),account=useTradingSummary();
  return <section className="order-panel trading-section" aria-labelledby="order-heading">
    <header className="section-heading"><h2 id="order-heading" className="section-title">주문</h2><span className="preview-label">모의투자</span></header>
    <TradingNavigation label="주문 목적" prefix="order" activeId={intent} onSelect={value=>{if(value==="open"||value==="close")setIntent(value);}} className="order-intent-tabs" tabs={[{id:"open",label:"진입 · Open",controls:"order-open-panel"},{id:"close",label:"청산 · Close",controls:"order-close-panel"}]}/>
    <div id="order-open-panel" role="tabpanel" aria-labelledby="order-open-tab" hidden={intent!=="open"}><OpenOrderPanel active={intent==="open"}/></div>
    <div id="order-close-panel" role="tabpanel" aria-labelledby="order-close-tab" hidden={intent!=="close"}><CloseOrderPanel active={intent==="close"}/></div>
    {snapshot.phase === "ready" && account.data && <WalletOverview wallet={account.data.wallet} />}
  </section>;
}
function OpenOrderPanel({active}:{active:boolean}) {
  const { symbol, market, bookSelection } = useSelectedMarket();
  const { snapshot } = useGuestSession();
  const account = useTradingSummary();
  const identity = `${snapshot.accountId}:${snapshot.generation}`;
  const [stored, setForm] = useState<Form>({ identity, symbolId: null, type: "MARKET", side: "LONG", leverage: 10, quantity: "", limitPrice: "", ratio: 0 });
  const leverageState = useSymbolLeverage(symbol?.id ?? null);
  const leverage = leverageState.data?.leverage ?? 10;
  const [seenBookSelection, setSeenBookSelection] = useState(bookSelection);
  const [result, setResult] = useState<{ order: TradingOrder; identity: string } | null>(null);
  const [serverWarning, setServerWarning] = useState<{ side: OpenForm["side"]; issue: OrderIssue } | null>(null);
  const switched = stored.symbolId !== (symbol?.id ?? null) || stored.identity !== identity;
  const form: Form = { ...formForSide(switched ? { ...formForSymbol(stored, symbol?.id ?? null), quantity: "", limitPrice: "", ratio: 0 } : stored, stored.side, leverage), identity };
  // Commit the reset, so switching A -> B -> A cannot resurrect A's old inputs.
  if (switched) { setForm(form); setResult(null); setServerWarning(null); }
  const action = useTradingMutation((issue, command, requestSession) => {
    if (command.kind !== "open" || command.tradingSymbolId !== symbol?.id || `${requestSession.accountId}:${requestSession.generation}` !== identity
      || command.quantity !== form.quantity.trim() || command.type !== form.type || command.leverage !== leverage
      || (command.type === "LIMIT" && command.limitPrice !== form.limitPrice.trim())) return;
    setServerWarning({ side: command.side, issue });
    window.alert(issue.message);
  });
  const mark = freshMarkPrice(market);
  const ready = leverageState.ready && snapshot.phase === "ready" && account.data?.status === "ACTIVE" && !!symbol && !!mark;
  const locked = action.pending || action.unconfirmed || leverageState.pending || snapshot.phase !== "ready";
  if (bookSelection !== seenBookSelection) {
    setSeenBookSelection(bookSelection);
    const next = bookSelection && bookSelection.identity === identity && active && !locked ? formForBookPrice(form,bookSelection.symbolId,bookSelection.price) : null;
    if (next) { setForm({...next,identity}); setResult(null); setServerWarning(null); }
  }
  const price = form.type === "LIMIT" ? form.limitPrice.trim() : mark?.decimal ?? "";
  const quantity = form.quantity.trim();
  const valid = validQuantity(quantity) && (form.type === "MARKET" || validLimitPrice(price));
  const canSize = ready && account.data?.wallet.availableBalance != null && (form.type === "LIMIT" ? validLimitPrice(price) : validSizingPrice(price));
  const ratioDisabled = locked || (form.type === "MARKET" && !canSize);
  const estimate = leverageState.data ? estimatedOrder(quantity, price, form.leverage) : null;
  function update(values: Partial<OpenForm>) { setForm({ ...formForSide({...form,...values},values.side??form.side,leverage), identity }); setResult(null); setServerWarning(null); action.clearError(); }
  function selectRatio(percent: number) {
    update({ ratio: percent, quantity: ratioInputQuantity(form.type,account.data?.wallet.availableBalance,price,form.leverage,percent) });
  }
  function complete(order: TradingOrder | null) {
    if (!order) return;
    setResult({ order, identity });
    setForm((current) => current.identity === identity && current.symbolId === order.tradingSymbolId ? { ...current, quantity: "", ratio: 0 } : current);
  }
  async function submit(side: "LONG" | "SHORT") {
    if (locked || leverageState.blocked()) return;
    update({ side });
    const commandForm = formForSide(form,side,leverage);
    const issue = preflightOrder(commandForm, side, ready, freshMarkPrice(market)?.decimal, account.data?.wallet.availableBalance);
    if (issue) { setServerWarning({ side, issue }); window.alert(issue.message); return; }
    if (!symbol) return;
    complete(await action.submit({ kind: "open", tradingSymbolId: symbol.id, type: form.type, side, quantity,
      leverage: commandForm.leverage, ...(form.type === "LIMIT" ? { limitPrice: price } : {}) }));
  }
  function warning(side: OpenForm["side"]) {
    if (serverWarning?.side === side) return serverWarning.issue;
    const relation = form.type === "LIMIT" ? marketableLimitIssue(side, price, mark?.decimal) : null;
    if (relation) return relation;
    const check = valid ? preflightOrder(formForSide(form,side,leverage), side, ready, mark?.decimal, account.data?.wallet.availableBalance) : null;
    return check?.kind === "balance" ? check : null;
  }
  return <div aria-describedby={snapshot.phase === "ready" ? "order-preview-note" : undefined}>
    {snapshot.phase !== "ready" ? <div className="order-panel-body"><GuestStartPrompt /></div> : <form className="order-panel-body" onSubmit={(event) => { event.preventDefault(); void submit(form.side); }}>
      <AccountWallet />
      <details className="order-settings" open>
        <summary>주문 설정</summary>
        <div className="order-settings-fields" data-order-type={form.type}>
          <OrderChoices legend="주문 유형" name="order-type" selected={form.type} disabled={locked} onChange={(value) => { if (value === "MARKET" || value === "LIMIT") update({ type: value, ratio: 0 }); }} choices={[{ value: "MARKET", label: "시장가" }, { value: "LIMIT", label: "지정가" }]} />
          <OrderChoices legend="포지션 방향" name="position-side" selected={form.side} disabled={locked} onChange={(value) => { if (value === "LONG" || value === "SHORT") update({ side: value }); }} choices={[{ value: "LONG", label: "↗ Long" }, { value: "SHORT", label: "↘ Short" }]} />
          <OrderLeverage value={leverageState.data?.leverage} max={leverageState.data?.maxLeverage} disabled={locked || !leverageState.ready} onChange={value => { update({ratio:0}); void leverageState.change(value); }} />
          {leverageState.pending && <p role="status" className="order-input-hint">레버리지 변경 및 계정 갱신 중…</p>}
          {leverageState.error && <div><p role="alert" className="order-warning">{leverageState.error}</p><button type="button" className="account-refresh" disabled={leverageState.pending} onClick={()=>void leverageState.refresh()}>레버리지 다시 조회</button></div>}
          {form.type === "LIMIT" && <OrderInput id="limit-price" label="지정가" unit="USDT" placeholder="가격 입력" value={form.limitPrice} disabled={locked} onChange={(value) => update({ limitPrice: value, ratio: 0 })} hint="양수 · 소수점 최대 18자리" />}
          <OrderInput id="order-quantity" label="주문 수량" unit={symbol?.symbol ?? "—"} placeholder="0.000" value={form.quantity} disabled={locked || !symbol} onChange={(value) => update({ quantity: value, ratio: 0 })} hint="양수 · 소수점 최대 8자리" />
          <div className="order-ratio">
            <label htmlFor="order-ratio" className="field-label">참고 자산 비율 <span className="float-right font-semibold tabular-nums text-brand-700">{form.ratio}%</span></label>
            <input id="order-ratio" type="range" min="0" max="100" step="1" value={form.ratio} disabled={ratioDisabled} onChange={(event) => selectRatio(Number(event.target.value))} className="h-8 w-full accent-brand-600" />
            <OrderChoices legend="비율 선택" name="ratio-preset" selected={String(form.ratio)} disabled={ratioDisabled} onChange={(value) => selectRatio(Number(value))} choices={[25, 50, 75, 100].map((value) => ({ value: String(value), label: `${value}%` }))} />
            <p className="order-input-hint">선택 비율로 수량을 채웁니다. 가격 변경 시 수량은 유지됩니다.</p>
            {!canSize && <p role="status" className="order-input-hint">{sizingUnavailable(form.type,price,ready,account.data?.wallet.availableBalance)}</p>}
          </div>
          <dl className="order-estimates"><div><dt>예상 주문 금액</dt><dd>{formatDecimal(estimate?.notional)} USDT</dd></div><div><dt>예상 필요 증거금 · <span data-side={form.side}>{form.side === "LONG" ? "Long" : "Short"} {leverageState.data ? `${form.leverage}×` : "—"}</span></dt><dd>{formatDecimal(estimate?.margin)} USDT</dd></div></dl>
        </div>
      </details>
      {form.quantity && !validQuantity(quantity) && !(form.type === "LIMIT" && quantity === "0" && !validLimitPrice(price)) && <p role="alert" className="order-input-hint">수량은 0보다 커야 하며 소수점은 8자리까지 지원합니다.</p>}
      {form.type === "LIMIT" && form.limitPrice && !validLimitPrice(price) && <p role="alert" className="order-input-hint">양수 지정가를 입력해 주세요. 소수점은 18자리까지 지원합니다.</p>}
      {!ready && <p role="status" className="order-input-hint">거래할 계정과 선택 종목의 최신 시세를 확인하는 중입니다.</p>}
      <div className="order-actions" role="group" aria-label="포지션 진입">
        {(["LONG", "SHORT"] as const).map((side) => <div key={side}>
          <button type="button" disabled={!ready || !valid || locked || !leverageState.ready} onClick={() => void submit(side)} data-side={side}>{side === "LONG" ? "↗ Long" : "↘ Short"} <span>{leverageState.data ? `${leverage}×` : "—"} · {action.pending ? "처리 중" : side === "LONG" ? "매수" : "매도"}</span></button>
          {warning(side) && <p role="alert" className="order-warning" data-warning-side={side}>{warning(side)?.message}</p>}
        </div>)}
      </div>
      {action.error && !serverWarning && (action.command?.kind !== "open" || action.command.tradingSymbolId === symbol?.id) && <p role="alert" className="order-warning">{action.error}</p>}
      {action.unconfirmed && <button type="button" className="account-refresh" disabled={action.pending} onClick={() => void action.retry().then(complete)}>같은 주문 결과 확인</button>}
      {result && result.identity === identity && result.order.tradingSymbolId === symbol?.id && <p role="status" className="order-input-hint">주문 #{result.order.orderId} · {result.order.status}{result.order.fill ? ` · 체결가 ${formatMarketPrice(result.order.fill.price, symbol.priceTickSize)} USDT` : ""}</p>}
      <p id="order-preview-note" className="order-preview-note">가상 자산을 사용하는 모의투자입니다. 금액은 체결 시 확정됩니다.</p>
    </form>}
  </div>;
}
