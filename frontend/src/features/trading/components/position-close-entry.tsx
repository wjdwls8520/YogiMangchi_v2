"use client";

import { useId, useRef, useState } from "react";
import { formatDecimal, formatQuantity, type Position } from "../api/account";
import { useTradingSummary } from "../api/queries";
import { useTradingMutation } from "../api/mutations";
import { closePreset, positionCloseCommand, positionValuation } from "../api/position-display";
import { validLimitPrice, validQuantity } from "../api/order-input";
import { comparePrices, formatMarketPrice } from "../market/price-format";
import { CloseOrderFields } from "./close-order-fields";
import { useGuestSession } from "./trading-data-provider";
import { useSelectedMarket } from "./selected-market-provider";

export function PositionCloseEntry({position,symbol,layout="panel",active=true}:{position:Position;symbol:string;layout?:"panel"|"row";active?:boolean}) {
  const prefix=useId(),dialog=useRef<HTMLDialogElement>(null),fullTrigger=useRef<HTMLButtonElement>(null);
  const {snapshot}=useGuestSession(),summary=useTradingSummary();
  const {positionPrices,bookSelection}=useSelectedMarket();
  const [seenBookSelection,setSeenBookSelection]=useState(bookSelection);
  const [expanded,setExpanded]=useState(false);
  const [type,setType]=useState<"MARKET"|"LIMIT">("MARKET");
  const [quantity,setQuantity]=useState(""),[limitPrice,setPrice]=useState(""),[ratio,setRatio]=useState(0);
  const [warning,setWarning]=useState<string|null>(null),[result,setResult]=useState<string|null>(null);
  const action=useTradingMutation();
  const locked=action.pending||action.unconfirmed||snapshot.phase!=="ready";
  const ready=snapshot.phase==="ready"&&summary.data?.status==="ACTIVE";
  const mark=positionPrices[position.tradingSymbolId],valuation=positionValuation(position,mark);
  const scope=layout==="row" ? "partial" : "available";
  const fullAvailable=comparePrices(position.freeCloseQuantity,position.quantity)===0;
  if(bookSelection!==seenBookSelection) {
    setSeenBookSelection(bookSelection);
    if(layout==="panel"&&active&&!locked&&bookSelection?.identity===`${snapshot.accountId}:${snapshot.generation}`) {
      if(bookSelection.symbolId===position.tradingSymbolId&&validLimitPrice(bookSelection.price)) {setType("LIMIT");setPrice(bookSelection.price);setRatio(0);setWarning(null);setResult(null);}
      else setWarning("호가 종목과 청산 포지션이 달라 가격을 입력하지 않았습니다. 같은 종목을 선택해 주세요.");
    }
  }
  function edit() {setWarning(null);setResult(null);action.clearError();}
  function preset(percent:number) {setQuantity(percent===0 ? "0" : closePreset(position.freeCloseQuantity,percent)||"0");setRatio(percent);edit();}
  function togglePartial() {if(!expanded&&!quantity) preset(50);setExpanded(!expanded);}
  async function execute(full=false) {
    if(action.pending||snapshot.phase!=="ready")return;
    if(action.unconfirmed) {const order=await action.retry();if(order){setResult(`청산 주문 #${order.orderId} · ${order.status}`);setQuantity("");setRatio(0);dialog.current?.close();}return;}
    const command=positionCloseCommand(position,full ? "MARKET" : type,full ? position.quantity : quantity.trim(),limitPrice.trim(),mark,ready,full ? "full" : scope);
    if(command.command===null) {setWarning(command.issue);window.alert(command.issue);return;}
    const order=await action.submit(command.command);
    if(order) {setResult(`청산 주문 #${order.orderId} · ${order.status}`);setQuantity("");setRatio(0);dialog.current?.close();}
  }
  const issue=quantity ? positionCloseCommand(position,type,quantity.trim(),limitPrice.trim(),mark,ready,scope).issue : null;
  const fullIssue=positionCloseCommand(position,"MARKET",position.quantity,"",mark,ready,"full").issue;
  return <div className="position-close-entry" data-layout={layout}>
    {layout==="row" && <div className="position-close-actions">
      <button type="button" disabled={locked} aria-label={`${symbol} ${position.side} 부분 청산`} aria-expanded={expanded} aria-controls={`${prefix}-editor`} onClick={togglePartial}>부분 청산</button>
      <button ref={fullTrigger} type="button" disabled={locked||!fullAvailable} aria-label={`${symbol} ${position.side} 전체 청산`} title={!fullAvailable ? "예약된 청산 주문을 먼저 취소해 주세요." : undefined} onClick={()=>{edit();dialog.current?.showModal();}}>전체 청산</button>
    </div>}
    {layout==="row"&&!fullAvailable && <p className="order-input-hint">청산 예약 중 · 전체 청산은 예약 취소 후 가능합니다.</p>}
    <form id={`${prefix}-editor`} hidden={layout==="row"&&!expanded} aria-label={`${symbol} ${position.side} 청산 주문`} onSubmit={event=>{event.preventDefault();void execute();}}>
      <p className="close-position-label"><strong>{symbol}</strong> <span data-side={position.side}>{position.side} {position.leverage}×</span></p>
      <dl className="close-availability"><div><dt>보유 수량</dt><dd>{formatQuantity(position.quantity)}</dd></div><div><dt>청산 가능</dt><dd>{formatQuantity(position.freeCloseQuantity)}</dd></div><div><dt>예약 수량</dt><dd>{formatQuantity(position.reservedCloseQuantity)}</dd></div></dl>
      <CloseOrderFields prefix={prefix} type={type} quantity={quantity} limitPrice={limitPrice} ratio={ratio} partialOnly={layout==="row"} disabled={locked} unit={symbol.split(" /")[0]}
        onType={value=>{if(value==="MARKET"||value==="LIMIT"){setType(value);edit();}}} onQuantity={value=>{setQuantity(value);setRatio(0);edit();}} onPrice={value=>{setPrice(value);setRatio(0);edit();}} onRatio={preset} />
      <p className="order-input-hint">청산 가능 수량 기준 · 기존 {position.leverage}× 유지 · {layout==="row" ? "전체 수량 미만만 주문합니다." : "100%는 예약되지 않은 수량 전부입니다."}</p>
      <p className="order-input-hint">Mark {formatMarketPrice(valuation.mark)} · 미실현 손익 {formatDecimal(valuation.pnl)} USDT</p>
      {(warning??action.error??issue) && <p role="alert" className="order-warning">{warning??action.error??issue}</p>}
      <button className="close-submit" disabled={locked||!validQuantity(quantity.trim())} type="submit">{action.pending ? "처리 중…" : type==="MARKET" ? "시장가 청산" : "지정가 청산 예약"}</button>
    </form>
    {action.unconfirmed && <div><p role="alert" className="order-warning">{action.error} 입력을 유지하고 같은 청산 결과를 확인해 주세요.</p><button type="button" className="account-refresh" disabled={action.pending} onClick={()=>void execute()}>같은 청산 결과 확인</button></div>}
    {result && <p role="status" className="order-input-hint">{result}</p>}
    <dialog ref={dialog} className="position-close-dialog" aria-labelledby={`${prefix}-full-title`} onCancel={event=>{if(action.pending)event.preventDefault();}} onClose={()=>fullTrigger.current?.focus({preventScroll:true})}>
      <h2 id={`${prefix}-full-title`}>{symbol} {position.side} 전체 청산</h2>
      <p>보유 수량 {formatQuantity(position.quantity)}을 시장가로 청산합니다. 실제 체결 가격과 손익은 서버가 결정합니다.</p>
      <p>현재 Mark {formatMarketPrice(valuation.mark)} · 미실현 손익 {formatDecimal(valuation.pnl)} USDT</p>
      {(warning??action.error??fullIssue) && <p role="alert" className="order-warning">{warning??action.error??fullIssue}</p>}
      <div className="guest-dialog-actions"><button type="button" className="guest-cancel" disabled={action.pending} onClick={()=>dialog.current?.close()}>취소</button><button className="guest-start-button" type="button" disabled={action.pending||(!action.unconfirmed&&!!fullIssue)} onClick={()=>void execute(true)}>{action.pending ? "처리 중…" : action.unconfirmed ? "같은 청산 결과 확인" : "전체 청산 확인"}</button></div>
    </dialog>
  </div>;
}
