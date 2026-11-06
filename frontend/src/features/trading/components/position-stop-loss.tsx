"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGuestSession } from "./trading-data-provider";
import { formatQuantity, type Position } from "../api/account";
import { parseStopLoss, latestStopLoss, type StopLoss, type StopLossCommand } from "../api/stop-loss-contract";
import { tradingKeys } from "../api/query-keys";
import { retryTradingQuery, TradingApiError } from "../api/client";
import { mutationStillUnconfirmed, mutationMessage } from "../api/mutation-request";
import { validLimitPrice } from "../api/order-input";
import { useTradingAdmission } from "../api/recovery";
import { formatMarketPrice } from "../market/price-format";
import { useJournalResolution } from "../api/journal-resolution";

function errorMessage(error: unknown) {
  const messages:Record<string,string> = {INVALID_STOP_LOSS:"양수 손절 가격을 입력해 주세요. 소수점은 18자리까지 지원합니다.",STOP_LOSS_NOT_PROTECTIVE:"LONG은 현재 Mark 아래, SHORT는 현재 Mark 위로 설정해 주세요.",STOP_LOSS_BEYOND_LIQUIDATION:"강제청산 예상가보다 먼저 보호되는 손절 가격이 필요합니다.",STOP_LOSS_VERSION_CONFLICT:"다른 요청으로 손절 설정이 변경됐습니다. 현재 값을 다시 확인해 주세요."};
  return error instanceof TradingApiError && error.code && messages[error.code] || mutationMessage(error);
}

export function PositionStopLoss({position,symbol}:{position:Position;symbol:string}) {
  const {session,snapshot}=useGuestSession(), client=useQueryClient(), admission=useTradingAdmission();
  const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),active=useRef(false);
  const unresolved=useRef<{command:StopLossCommand;key:string;accountId:number|null;generation:number}|null>(null);
  const [journalRequest,setJournalRequest]=useState<{accountId:number|null;key:string;command:{kind:"stopLoss"}&StopLossCommand}|null>(null);
  const [open,setOpen]=useState(false),[price,setPrice]=useState(""),[pending,setPending]=useState(false),[unknown,setUnknown]=useState(false),[message,setMessage]=useState("");
  const identity=`${snapshot.accountId}:${snapshot.generation}`;
  const query=useQuery({queryKey:[...tradingKeys.account(snapshot),"stop-loss",position.id],enabled:open&&snapshot.phase==="ready",retry:retryTradingQuery, structuralSharing:(old,value)=>latestStopLoss(old as StopLoss|undefined,value as StopLoss)!,
    queryFn:async({signal})=>parseStopLoss(await session.read(`account/positions/${position.id}/stop-loss`,snapshot,signal),position.id,position.tradingSymbolId,position.side)});
  const current=latestStopLoss(query.data,position.stopLoss);
  useJournalResolution(journalRequest,()=>{unresolved.current=null;setJournalRequest(null);setUnknown(false);setMessage("서버에서 기존 손절 요청을 확인했습니다. 최신 설정을 다시 조회합니다.");void query.refetch();});
  async function submit(remove=false) {
    if(active.current||snapshot.phase!=="ready")return;
    if(!unresolved.current && (!query.data || query.isError || !(remove ? admission.cancel : admission.trade))) {setMessage("현재 서버 상태에서는 이 요청을 제출할 수 없습니다.");return;}
    if(unresolved.current&&(unresolved.current.accountId!==snapshot.accountId||unresolved.current.generation!==snapshot.generation)) {unresolved.current=null;setJournalRequest(null);setUnknown(false);return;}
    const request=unresolved.current??{command:{positionId:position.id,expectedVersion:current!.version,...(remove?{}:{stopPrice:price.trim()})},key:crypto.randomUUID(),accountId:snapshot.accountId,generation:snapshot.generation};
    const wasUnconfirmed=!!unresolved.current;
    active.current=true;setPending(true);setMessage("");
    const same=()=>`${session.getSnapshot().accountId}:${session.getSnapshot().generation}`===identity;
    try {
      const result=parseStopLoss(await session.writeStopLoss(request.command,snapshot,request.key),position.id,position.tradingSymbolId,position.side);
      if(!same())return;
      unresolved.current=null;setJournalRequest(null);setUnknown(false);setPrice("");
      client.setQueryData([...tradingKeys.account(snapshot),"stop-loss",position.id],(old:StopLoss|undefined)=>latestStopLoss(old,position.stopLoss,result));
      setMessage("손절 설정 요청이 처리되었습니다. 아래 서버의 현재 상태를 확인해 주세요.");
    } catch(error) {
      if(!same())return;
      unresolved.current=mutationStillUnconfirmed(error,wasUnconfirmed)?request:null;setJournalRequest(unresolved.current?{accountId:request.accountId,key:request.key,command:{kind:"stopLoss",...request.command}}:null);setUnknown(!!unresolved.current);setMessage(errorMessage(error));
    } finally {
      if(same()) {setPending(false);void query.refetch();void client.invalidateQueries({queryKey:[...tradingKeys.account(snapshot),"summary"]});}
      active.current=false;
    }
  }
  return <div className="position-stop-loss">
    <button ref={trigger} type="button" aria-haspopup="dialog" aria-label={`${symbol} ${position.side} 손절 설정`} disabled={snapshot.phase!=="ready"} onClick={()=>{setOpen(true);dialog.current?.showModal();}}>{current?.status==="ACTIVE"?formatMarketPrice(current.stopPrice):"설정"}</button>
    <dialog ref={dialog} className="position-close-dialog" aria-modal="true" aria-labelledby={`stop-loss-${position.id}`} onCancel={event=>{if(pending)event.preventDefault();}} onClose={()=>{setOpen(false);trigger.current?.focus({preventScroll:true});}}>
      <h2 id={`stop-loss-${position.id}`}>{symbol} <span data-side={position.side}>{position.side}</span> Stop Loss</h2>
      <p>서버 Mark 기준으로 잔여 포지션 전량을 시장가 청산합니다. 추가 진입·부분 청산에 따라 대상 수량이 조정됩니다. 지정 가격의 체결을 보장하지 않으며, 가격 급변 시 손절 전에 강제청산될 수 있습니다.</p>
      <p>잔여 수량 {formatQuantity(position.quantity)} · 전량 손절 · Mark 기준</p>
      {query.isPending&&<p role="status">손절 상태 확인 중…</p>}{query.isError&&<p role="alert">손절 설정을 조회하지 못했습니다. <button onClick={()=>void query.refetch()}>다시 조회</button></p>}{(query.data||unknown)&&<>
        <p>{current ? ({NONE:"손절 설정 없음",ACTIVE:"손절 설정됨",CANCELED:"손절 해제됨",TRIGGERED:"손절 발동 완료",EXPIRED:"포지션 종료로 손절 만료"})[current.status] : "손절 상태 확인 필요"} · 가격 {formatMarketPrice(current?.stopPrice)}</p>
        <form onSubmit={event=>{event.preventDefault();void submit();}}>
          <label className="field-label" htmlFor={`sl-price-${position.id}`}>새 손절 가격 · USDT</label>
          <input id={`sl-price-${position.id}`} className="order-leverage-input" inputMode="decimal" value={price} disabled={pending||unknown} placeholder={current?.stopPrice??"손절 가격"} onChange={event=>setPrice(event.target.value)} />
          {message&&<p role="status" className="order-warning">{message}</p>}
          {unknown&&<p>결과가 미확정입니다. 원래 요청을 재전송하면 아직 접수되지 않은 손절 설정·해제가 실행될 수 있습니다. 현재 조회값은 다른 창에서 변경한 내용일 수 있습니다.</p>}
          <div className="guest-dialog-actions"><button type="button" className="guest-cancel" disabled={pending} onClick={()=>dialog.current?.close()}>닫기</button>
            {unknown?<button type="button" disabled={pending} onClick={()=>void submit(unresolved.current?.command.stopPrice===undefined)}>원래 손절 요청 재전송</button>:<>
              <button className="guest-start-button" type="submit" disabled={pending||!admission.trade||!validLimitPrice(price.trim())}>{pending?"처리 중…":current?.status==="ACTIVE"?"손절 수정":"손절 설정"}</button>
              {current?.status==="ACTIVE"&&<button type="button" disabled={pending||!admission.cancel} onClick={()=>void submit(true)}>손절 해제</button>}
            </>}
          </div>
        </form>
      </>}
    </dialog>
  </div>;
}
