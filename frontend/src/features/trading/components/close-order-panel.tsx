"use client";

import { useState } from "react";
import { useTradingSummary } from "../api/queries";
import { formatQuantity, symbolLabel } from "../api/account";
import { useGuestSession } from "./trading-data-provider";
import { useMarketDetails } from "./selected-market-provider";
import { GuestStartPrompt } from "./guest-access";
import { AccountQueryState } from "./account-query-state";
import { PositionCloseEntry } from "./position-close-entry";

export function CloseOrderPanel({active}:{active:boolean}) {
  const query=useTradingSummary(),{snapshot}=useGuestSession(),{symbols,symbol}=useMarketDetails();
  const [chosen,setChosen]=useState<number|null>(null);
  const positions=query.data?.positions??[];
  const selected=positions.find(position=>position.id===chosen)??positions.find(position=>position.tradingSymbolId===symbol?.id)??positions[0];
  if(snapshot.phase!=="ready")return <div className="order-panel-body"><GuestStartPrompt/></div>;
  return <div>
    <AccountQueryState loading={query.loading} error={query.error} empty={query.data&&!positions.length ? "청산할 포지션이 없습니다. Open 탭에서 먼저 포지션을 진입해 주세요." : undefined} onRetry={query.retry} busy={query.busy}/>
    {selected && <div className="close-position-select"><label className="field-label" htmlFor="close-position-select">청산 포지션 · 포지션별 주문</label>
      <select id="close-position-select" value={selected.id} onChange={event=>setChosen(Number(event.target.value))}>{positions.map(position=><option key={position.id} value={position.id}>{symbolLabel(position.tradingSymbolId,symbols)} · {position.side} {position.leverage}× · {formatQuantity(position.quantity)} · #{position.id}</option>)}</select>
    </div>}
    {positions.map(position=><div className="close-panel-position order-panel-body" key={`${snapshot.accountId}:${snapshot.generation}:${position.id}`} hidden={selected?.id!==position.id}>
      <PositionCloseEntry position={position} symbol={symbolLabel(position.tradingSymbolId,symbols)} active={active&&selected?.id===position.id}/>
    </div>)}
  </div>;
}
