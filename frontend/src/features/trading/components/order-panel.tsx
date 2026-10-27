"use client";

import { useQueryClient } from "@tanstack/react-query";
import { reportAdmissionRejection } from "../api/admission-rejection";
import { useTradingNotices } from "./trading-notices";
import { useEffect, useRef, useState } from "react";
import { AccountWallet } from "./account-wallet";
import { OrderChoices, OrderInput, OrderLeverage } from "./order-controls";
import { useSelectedMarket } from "./selected-market-provider";
import { useGuestSession } from "./trading-data-provider";
import { freshMarkPrice } from "../market/selected-market";
import { useTradingSummary } from "../api/queries";
import { readQuote } from "../api/quote";
import { useOrderQuote } from "../api/quote-query";
import { mutationMessage } from "../api/mutation-request";
import { isolatedReady } from "../api/margin";
import { useSymbolLeverage } from "../api/leverage";
import { useTradingMutation } from "../api/mutations";
import { validLimitPrice, validQuantity, validSizingPrice } from "../api/order-input";
import { formForSymbol, formForSide, formForBookPrice, marketableLimitIssue, preflightOrder, sizingUnavailable, type OpenForm, type OrderIssue } from "../api/order-preflight";
import { formatDecimal } from "../api/account";
import type { TradingOrder } from "../api/orders";
import { orderStatusLabel } from "../api/orders";
import { orderReason } from "../api/order-reason";
import { formatMarketPrice } from "../market/price-format";
import { GuestStartPrompt } from "./guest-access";
import { WalletOverview } from "./wallet-overview";
import { CloseOrderPanel } from "./close-order-panel";
import { TradingNavigation } from "./trading-navigation";
import { RecoveryStatus } from "./recovery-status";
import { GuestRetry } from "./guest-retry";

type Form = OpenForm & { identity: string };
export function OrderPanel() {
  const [intent,setIntent]=useState<"open"|"close">("open");
  const {snapshot}=useGuestSession(),account=useTradingSummary();
  return <section className="order-panel trading-section" aria-labelledby="order-heading">
    <header className="section-heading"><h2 id="order-heading" className="section-title">주문</h2><span className="preview-label">모의투자</span></header>
    <TradingNavigation label="주문 목적" prefix="order" activeId={intent} onSelect={value=>{if(value==="open"||value==="close")setIntent(value);}} className="order-intent-tabs" tabs={[{id:"open",label:"진입 · Open",controls:"order-open-panel"},{id:"close",label:"청산 · Close",controls:"order-close-panel"}]}/>
    {snapshot.phase === "ready" && <RecoveryStatus />}
    <div id="order-open-panel" role="tabpanel" aria-labelledby="order-open-tab" hidden={intent!=="open"}><OpenOrderPanel active={intent==="open"}/></div>
    <div id="order-close-panel" role="tabpanel" aria-labelledby="order-close-tab" hidden={intent!=="close"}><CloseOrderPanel active={intent==="close"}/></div>
    {snapshot.phase === "ready" && account.data && <WalletOverview wallet={account.data.wallet} stale={account.stale} />}
    <GuestRetry />
  </section>;
}
function OpenOrderPanel({active}:{active:boolean}) {
  const { symbol, market, bookSelection } = useSelectedMarket();
  const { session, snapshot } = useGuestSession();
  const account = useTradingSummary();
  const notices = useTradingNotices();
  const client = useQueryClient();
  const sizingRequest = useRef<AbortController | null>(null), sizingTicket = useRef(0), submitting = useRef(false);
  const preflightRequest = useRef<AbortController | null>(null);
  const [sizing,setSizing] = useState<{identity:string;symbolId:number;ticket:number}|null>(null);
  const [preparing,setPreparing] = useState(false);
  const identity = `${snapshot.accountId}:${snapshot.generation}`;
  const [stored, setForm] = useState<Form>({ identity, symbolId: null, type: "MARKET", side: "LONG", leverage: 10, quantity: "", limitPrice: "", ratio: 0 });
  const longLeverage = useSymbolLeverage(symbol?.id ?? null, "LONG"), shortLeverage = useSymbolLeverage(symbol?.id ?? null, "SHORT");
  const leverageState = stored.side === "LONG" ? longLeverage : shortLeverage;
  const leverage = leverageState.data?.leverage ?? 10;
  const [seenBookSelection, setSeenBookSelection] = useState(bookSelection);
  const [result, setResult] = useState<{ order: TradingOrder; identity: string } | null>(null);
  const [serverWarning, setServerWarning] = useState<{ side: OpenForm["side"]; issue: OrderIssue } | null>(null);
  const switched = stored.symbolId !== (symbol?.id ?? null) || stored.identity !== identity;
  const form: Form = { ...formForSide(switched ? { ...formForSymbol(stored, symbol?.id ?? null), quantity: "", limitPrice: "", ratio: 0 } : stored, stored.side, leverage), identity };
  // Commit the reset, so switching A -> B -> A cannot resurrect A's old inputs.
  if (switched) { setForm(form); setResult(null); setServerWarning(null); }
  useEffect(() => () => { sizingRequest.current?.abort(); preflightRequest.current?.abort(); }, [identity,symbol?.id]);
  const action = useTradingMutation((issue, command, requestSession) => {
    if (command.kind !== "open" || command.tradingSymbolId !== symbol?.id || `${requestSession.accountId}:${requestSession.generation}` !== identity
      || command.quantity !== form.quantity.trim() || command.type !== form.type || command.leverage !== leverage
      || (command.type === "LIMIT" && command.limitPrice !== form.limitPrice.trim())) return;
    setServerWarning({ side: command.side, issue });
  });
  const mark = freshMarkPrice(market);
  const ready = !account.error && isolatedReady(account.data?.wallet) && leverageState.ready && snapshot.phase === "ready" && account.data?.status === "ACTIVE" && !!symbol && !!mark;
  const locked = snapshot.retrying || preparing || action.pending || action.unconfirmed || snapshot.phase !== "ready";
  const submitLocked = locked || action.blocked || longLeverage.pending || shortLeverage.pending;
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
  const quoteRequest = symbol ? {tradingSymbolId:symbol.id,type:form.type,side:form.side,quantity,...(form.type === "LIMIT" ? {limitPrice:price} : {})} : null;
  const quote = useOrderQuote(quoteRequest, active && ready && valid && !preparing);
  const estimate = quote.data?.leverage === leverage ? quote.data : undefined;
  const sizingPending = sizing?.identity === identity && sizing.symbolId === symbol?.id;
  function update(values: Partial<OpenForm>) {
    sizingRequest.current?.abort(); sizingRequest.current=null; sizingTicket.current++; setSizing(null);
    setForm({ ...formForSide({...form,...values},values.side??form.side,leverage), identity }); setResult(null); setServerWarning(null); action.clearError();
  }
  async function selectRatio(percent: number) {
    if (locked) return;
    if (percent === 0 || (form.type === "LIMIT" && !validLimitPrice(price))) { update({ratio:percent,quantity:"0"}); return; }
    if (!canSize || !symbol) return;
    update({ratio:percent});
    const ticket=++sizingTicket.current, controller=new AbortController(); sizingRequest.current=controller;
    setSizing({identity,symbolId:symbol.id,ticket});
    try {
      const value=await readQuote(session,snapshot,{tradingSymbolId:symbol.id,type:form.type,side:form.side,balancePercentage:percent,...(form.type==="LIMIT" ? {limitPrice:price} : {})},controller.signal);
      if (sizingTicket.current!==ticket || value.leverage!==leverage) return;
      setForm(current=>current.identity===identity&&current.symbolId===symbol.id&&current.ratio===percent&&current.type===form.type&&current.side===form.side&&current.limitPrice===form.limitPrice ? {...current,quantity:value.quantity,ratio:percent} : current);
    } catch(error) {
      if (!controller.signal.aborted) reportAdmissionRejection(client, snapshot, error);
      if (!controller.signal.aborted && sizingTicket.current===ticket) notices.push({kind:"error",title:"비율 수량을 계산하지 못했습니다",message:mutationMessage(error)});
    } finally {
      if (sizingTicket.current===ticket) sizingRequest.current=null;
      setSizing(current=>current?.ticket===ticket ? null : current);
    }
  }
  function complete(order: TradingOrder | null) {
    if (!order) return;
    setResult({ order, identity });
    if (order.status !== "FILLED" && order.status !== "PENDING") return;
    setForm((current) => current.identity === identity && current.symbolId === order.tradingSymbolId ? { ...current, quantity: "", ratio: 0 } : current);
  }
  async function submit(side: "LONG" | "SHORT") {
    const leverageState = side === "LONG" ? longLeverage : shortLeverage;
    const leverage = leverageState.data?.leverage ?? 10;
    if (submitLocked || leverageState.blocked() || submitting.current || sizingRequest.current) return;
    update({ side });
    const commandForm = formForSide(form,side,leverage);
    const issue = preflightOrder(commandForm, side, ready, freshMarkPrice(market)?.decimal, account.data?.wallet.availableBalance);
    if (issue && !(issue.kind === "balance" && form.ratio > 0)) { setServerWarning({ side, issue }); notices.push({kind:"error",title:"주문을 제출할 수 없습니다",message:issue.message}); return; }
    if (!symbol) return;
    submitting.current=true; setPreparing(true);
    const controller=new AbortController(); preflightRequest.current=controller;
    try {
      const value=await readQuote(session,snapshot,{tradingSymbolId:symbol.id,type:form.type,side,...(form.ratio > 0 ? {balancePercentage:form.ratio} : {quantity}),...(form.type==="LIMIT" ? {limitPrice:price} : {})},controller.signal);
      if(controller.signal.aborted)return;
      if (value.leverage!==leverage) { await leverageState.refresh(); notices.push({kind:"warning",title:"레버리지를 확인해 주세요",message:"서버 설정을 다시 조회했습니다. 확인 후 직접 주문해 주세요."}); return; }
      complete(await action.submit({ kind: "open", tradingSymbolId: symbol.id, type: form.type, side, quantity: value.quantity,
        leverage: value.leverage, ...(form.type === "LIMIT" ? { limitPrice: price } : {}) }));
    } catch(error) { if(!controller.signal.aborted)reportAdmissionRejection(client, snapshot, error); if(!controller.signal.aborted)notices.push({kind:"error",title:"주문 견적을 확인하지 못했습니다",message:mutationMessage(error)}); }
    finally { preflightRequest.current=null;submitting.current=false;setPreparing(false); }
  }
  function warning(side: OpenForm["side"]) {
    if (serverWarning?.side === side) return serverWarning.issue;
    const relation = form.type === "LIMIT" ? marketableLimitIssue(side, price, mark?.decimal) : null;
    if (relation) return relation;
    const target = side === "LONG" ? longLeverage : shortLeverage;
    const check = valid ? preflightOrder(formForSide(form,side,target.data?.leverage ?? 10), side, ready && target.ready, mark?.decimal, account.data?.wallet.availableBalance) : null;
    return check?.kind === "balance" && form.ratio === 0 ? check : null;
  }
  return <div aria-describedby={snapshot.phase === "ready" ? "order-preview-note" : undefined}>
    {snapshot.phase !== "ready" ? <div className="order-panel-body"><GuestStartPrompt /></div> : <form className="order-panel-body" onSubmit={(event) => { event.preventDefault(); void submit(form.side); }}>
      <AccountWallet />
      <details className="order-settings" open>
        <summary>주문 설정</summary>
        <div className="order-settings-fields" data-order-type={form.type}>
          <OrderChoices legend="주문 유형" name="order-type" selected={form.type} disabled={locked} onChange={(value) => { if (value === "MARKET" || value === "LIMIT") update({ type: value, ratio: 0 }); }} choices={[{ value: "MARKET", label: "시장가" }, { value: "LIMIT", label: "지정가" }]} />
          <OrderChoices legend="포지션 방향" name="position-side" selected={form.side} disabled={locked} onChange={(value) => { if (value === "LONG" || value === "SHORT") update({ side: value, ratio: 0 }); }} choices={[{ value: "LONG", label: "↗ Long" }, { value: "SHORT", label: "↘ Short" }]} />
          <OrderLeverage side={form.side} value={leverageState.data?.leverage} max={leverageState.data?.maxLeverage} disabled={locked || !leverageState.ready} onChange={value => { update({ratio:0}); void leverageState.change(value); }} />
          {(longLeverage.pending || shortLeverage.pending) && <p role="status" className="order-input-hint">{[longLeverage.pending ? "Long" : null, shortLeverage.pending ? "Short" : null].filter(Boolean).join(" · ")} 레버리지 변경 및 계정 갱신 중…</p>}
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
          <dl className="order-estimates"><div><dt>예상 주문 금액</dt><dd>{formatDecimal(estimate?.notional)} USDT</dd></div><div><dt>예상 필요 증거금 · <span data-side={form.side}>{form.side === "LONG" ? "Long" : "Short"} {leverageState.data ? `${form.leverage}×` : "—"}</span></dt><dd>{formatDecimal(estimate?.margin)} USDT</dd></div><div><dt>예상 수수료</dt><dd>{formatDecimal(estimate?.estimatedFee)} USDT</dd></div><div><dt>총 필요 자산 · 담보 + 수수료</dt><dd>{formatDecimal(estimate?.totalRequired)} USDT</dd></div></dl>
        </div>
      </details>
      {sizingPending && <p role="status" className="order-input-hint">서버에서 수수료 포함 비율 수량을 계산 중입니다.</p>}
      {quote.error && <p role="status" className="order-input-hint">서버 견적: {quote.error}</p>}
      {form.quantity && !validQuantity(quantity) && !(form.type === "LIMIT" && quantity === "0" && !validLimitPrice(price)) && <p role="alert" className="order-input-hint">수량은 0보다 커야 하며 소수점은 8자리까지 지원합니다.</p>}
      {form.type === "LIMIT" && form.limitPrice && !validLimitPrice(price) && <p role="alert" className="order-input-hint">양수 지정가를 입력해 주세요. 소수점은 18자리까지 지원합니다.</p>}
      {account.data && !isolatedReady(account.data.wallet) && <p role="alert" className="order-warning">이전 담보 방식의 전환 확인이 필요합니다. 전환 완료 전에는 주문할 수 없습니다.</p>}
      {!ready && <p role="status" className="order-input-hint">거래할 계정과 선택 종목의 최신 시세를 확인하는 중입니다.</p>}
      <div className="order-actions" role="group" aria-label="포지션 진입">
        {(["LONG", "SHORT"] as const).map((side) => <div key={side}>
          <button type="button" disabled={!ready || !valid || submitLocked || !(side === "LONG" ? longLeverage : shortLeverage).ready || sizingPending} onClick={() => void submit(side)} data-side={side}>{side === "LONG" ? "↗ Long" : "↘ Short"} <span>{(side === "LONG" ? longLeverage : shortLeverage).data ? `${(side === "LONG" ? longLeverage : shortLeverage).data!.leverage}×` : "설정 확인 중"} · {action.pending || preparing ? "처리 중" : side === "LONG" ? "매수" : "매도"}</span></button>
          {warning(side) && <p role="alert" className="order-warning" data-warning-side={side}>{warning(side)?.message}</p>}
        </div>)}
      </div>
      {action.error && !serverWarning && (action.command?.kind !== "open" || action.command.tradingSymbolId === symbol?.id) && <p role="alert" className="order-warning">{action.error}</p>}
      {action.unconfirmed && <button type="button" className="account-refresh" disabled={action.pending} onClick={() => void action.retry().then(complete)}>같은 주문 결과 확인</button>}
      {result && result.identity === identity && result.order.tradingSymbolId === symbol?.id && <p role="status" className="order-input-hint">주문 #{result.order.orderId} · {orderStatusLabel(result.order.status)}{result.order.status === "REJECTED" ? ` · ${orderReason(result.order.reason)}` : ""}{result.order.fill ? ` · 체결가 ${formatMarketPrice(result.order.fill.price, symbol.priceTickSize)} USDT` : ""}</p>}
      <p id="order-preview-note" className="order-preview-note">레버리지는 방향별 담보·ROE를 바꾸며 같은 가격·수량의 절대 손익을 늘리지 않습니다. 금액은 체결 시 확정됩니다.</p>
    </form>}
  </div>;
}
