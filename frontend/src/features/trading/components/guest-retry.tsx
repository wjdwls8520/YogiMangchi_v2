"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useGuestSession } from "./trading-data-provider";
import { reportAdmissionRejection } from "../api/admission-rejection";
import { mutationMessage, mutationStillUnconfirmed, unconfirmedMutationMessage } from "../api/mutation-request";

import { useTradingAdmission } from "../api/recovery";

export function GuestRetry() {
  const admission = useTradingAdmission(), client = useQueryClient();
  const {session,snapshot}=useGuestSession();
  const dialog=useRef<HTMLDialogElement>(null),active=useRef(false);
  const [pending,setPending]=useState(false),[confirmation,setConfirmation]=useState<{accountId:number;key:string}|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [completed,setCompleted]=useState<{accountId:number;message:string}|null>(null);
  const unresolved=confirmation?.accountId===snapshot.accountId ? confirmation : null;
  async function execute(){
    if((!unresolved&&!admission.trade)||active.current||snapshot.phase!=="ready"||snapshot.retrying||!snapshot.accountId)return;
    active.current=true;setPending(true);setError(null);
    const request=unresolved??{accountId:snapshot.accountId,key:crypto.randomUUID()};
    try {
      const result=await session.retryGuest(snapshot,request.key);
      if(session.getSnapshot().accountId!==request.accountId||session.getSnapshot().mode)return;
      setConfirmation(null);dialog.current?.close();
      setCompleted({accountId:result.accountId,message:`같은 Guest 계정으로 재시작했습니다. 미체결 ${result.canceledOrderCount}건 취소 · 포지션 ${result.closedPositionCount}건 종료. 현재 잔액은 서버에서 다시 조회합니다.`});
    } catch(error){
      if(session.getSnapshot().accountId!==request.accountId||session.getSnapshot().mode)return;
      reportAdmissionRejection(client,snapshot,error);
      const uncertain=mutationStillUnconfirmed(error,!!unresolved);
      setConfirmation(uncertain ? request : null);
      setError(uncertain ? unconfirmedMutationMessage : mutationMessage(error));
    } finally {active.current=false;setPending(false);}
  }
  if(snapshot.phase!=="ready" || snapshot.mode)return null;
  return <div className="guest-retry">
    <button type="button" className="account-refresh" disabled={(!unresolved&&!admission.trade)||pending||snapshot.retrying} onClick={()=>{setError(unresolved ? unconfirmedMutationMessage : null);dialog.current?.showModal();}}>{unresolved ? "원래 재도전 요청 재전송" : "모의투자 재도전"}</button>
    {completed?.accountId===snapshot.accountId&&<p role="status" className="order-input-hint">{completed.message}</p>}
    <dialog ref={dialog} className="position-close-dialog" aria-modal="true" aria-labelledby="guest-retry-title" onCancel={event=>{if(pending)event.preventDefault();}}>
      <h2 id="guest-retry-title">같은 Guest 계정으로 다시 시작</h2>
      <p>미체결 주문을 취소하고 모든 포지션을 종료한 뒤 모의 자금을 10,000 USDT로 초기화합니다.</p>
      <p>현재 계정 ID와 만료일, 레버리지 설정, 기존 거래 이력은 유지됩니다. 이 포지션 종료로 체결이나 손익이 새로 발생하지 않습니다.</p>
      {error&&<p role="alert" className="order-warning">{error}</p>}
      <div className="guest-dialog-actions"><button type="button" className="guest-cancel" disabled={pending} onClick={()=>dialog.current?.close()}>닫기</button><button type="button" className="guest-start-button" disabled={(!unresolved&&!admission.trade)||pending||snapshot.retrying} onClick={()=>void execute()}>{pending ? "처리 중…" : unresolved ? "원래 재도전 요청 재전송" : "모의 자금 초기화 확인"}</button></div>
    </dialog>
  </div>;
}
