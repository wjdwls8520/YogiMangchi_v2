"use client";

import type { Position } from "../api/account";
import { useTradingMutation } from "../api/mutations";
import { useGuestSession } from "./trading-data-provider";
import { useRef, useState } from "react";
import { ClosePositionDialog } from "./close-position-dialog";
import { useSelectedMarket } from "./selected-market-provider";
import { useTradingSummary } from "../api/queries";
import { closePreflight, closePreset, positionValuation } from "../api/position-display";
import { formatDecimal } from "../api/account";
import { formatMarketPrice } from "../market/price-format";
import { mutationMessage } from "../api/mutation-request";

export function ClosePositionButton({ position, symbol }: { position: Position; symbol: string }) {
  const { snapshot } = useGuestSession();
  const summary = useTradingSummary();
  const { positionPrices } = useSelectedMarket();
  const mark = positionPrices[position.tradingSymbolId];
  const valuation = positionValuation(position,mark);
  const dialog=useRef<HTMLDialogElement>(null), trigger=useRef<HTMLButtonElement>(null);
  const [type,setType]=useState<"MARKET"|"LIMIT">("MARKET");
  const [quantity,setQuantity]=useState(""), [limitPrice,setPrice]=useState(""), [ratio,setRatio]=useState(0), [warning,setWarning]=useState<string|null>(null);
  const action = useTradingMutation(undefined,(error)=>{const message=mutationMessage(error);setWarning(message);window.alert(message);});
  const ready=snapshot.phase==="ready"&&summary.data?.status==="ACTIVE";
  function edit() { setWarning(null);action.clearError(); }
  function open() {
    if (!action.unconfirmed) {setType("MARKET");setQuantity(position.freeCloseQuantity);setRatio(100);setPrice("");edit();}
    dialog.current?.showModal();
  }
  async function submit() {
    if (action.pending) return;
    if (action.unconfirmed) {if (await action.retry()) dialog.current?.close();return;}
    const issue=closePreflight(position,type,quantity.trim(),limitPrice.trim(),mark,ready);
    if (issue) {setWarning(issue);window.alert(issue);return;}
    const order=await action.submit(type==="MARKET" ? {kind:"close",positionId:position.id,quantity:quantity.trim()} : {kind:"limitClose",positionId:position.id,quantity:quantity.trim(),limitPrice:limitPrice.trim()});
    if (order) dialog.current?.close();
  }
  return <div>
    <button ref={trigger} type="button" disabled={action.pending || snapshot.phase!=="ready"} aria-haspopup="dialog" aria-label={`${symbol} ${position.side} 포지션 청산`} onClick={open}>
      {action.pending ? "청산 중" : action.unconfirmed ? "청산 결과 확인" : "청산"}
    </button>
    <ClosePositionDialog dialogRef={dialog} position={position} symbol={symbol} mark={formatMarketPrice(valuation.mark)} pnl={formatDecimal(valuation.pnl)} type={type} quantity={quantity} limitPrice={limitPrice} ratio={ratio} locked={action.pending} unconfirmed={action.unconfirmed}
      warning={warning??action.error??(quantity ? closePreflight(position,type,quantity.trim(),limitPrice.trim(),mark,ready) : null)}
      onType={value=>{if(value==="MARKET"||value==="LIMIT"){setType(value);edit();}}} onQuantity={value=>{setQuantity(value);setRatio(0);edit();}} onPrice={value=>{setPrice(value);setRatio(0);edit();}}
      onRatio={percent=>{setQuantity(closePreset(position.freeCloseQuantity,percent));setRatio(percent);edit();}} onSubmit={()=>void submit()} onCancel={()=>dialog.current?.close()} onClose={()=>trigger.current?.focus({preventScroll:true})} />
  </div>;
}
export function CancelOrderButton({ orderId, symbol }: { orderId: number; symbol: string }) {
  const action = useTradingMutation();
  const { snapshot } = useGuestSession();
  return <div>
    <button type="button" disabled={action.pending || snapshot.phase !== "ready"} aria-label={`${symbol} 주문 #${orderId} 취소`}
      onClick={() => { if (action.unconfirmed) void action.retry(); else void action.submit({ kind: "cancel", orderId }); }}>
      {action.pending ? "취소 중" : action.unconfirmed ? "결과 확인" : "취소"}
    </button>
    {action.error && <p role="alert" className="order-input-hint">{action.error}</p>}
  </div>;
}
