"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGuestSession } from "./trading-data-provider";
import { COMMAND_JOURNAL_EVENT, CommandJournalError, isCommandJournalKey, type JournalEntry, type JournalOwner } from "../api/command-journal";
import { commandResultSettled } from "../api/command-result";
import { mutationMessage } from "../api/mutation-request";
import { tradingKeys } from "../api/query-keys";
import { orderStatusLabel } from "../api/orders";

function describe(entry:JournalEntry) {
  const c=entry.command;
  if(c.kind==="open")return `${c.side==="LONG"?"Long":"Short"} ${c.type==="MARKET"?"시장가":"지정가"} 진입 · 종목 #${c.tradingSymbolId} · 수량 ${c.quantity}`;
  if(c.kind==="cancel")return `주문 #${c.orderId} 취소`;
  if(c.kind==="stopLoss")return `포지션 #${c.positionId} 손절 ${c.stopPrice===undefined?"해제":"설정·수정"}`;
  if(c.kind==="close"||c.kind==="limitClose")return `포지션 #${c.positionId} ${c.kind==="close"?"시장가":"지정가"} 청산 · ${c.quantity??"전량"}`;
  return c.kind==="guestRetry"?"Guest 모의 자금 재도전":"회원 모의투자 회차 다시시작";
}
const ownerId=(owner:JournalOwner|null)=>owner?`${owner.origin}:${owner.mode}:${owner.accountId}`:"";

export function TradingCommandRecovery() {
  const {session,snapshot}=useGuestSession(),client=useQueryClient();
  const identity=ownerId(session.getCommandOwner());
  const [view,setView]=useState<{identity:string;entries:JournalEntry[];error:string|null}>({identity:"",entries:[],error:null});
  const [messages,setMessages]=useState<Record<string,string>>({}),[canResend,setCanResend]=useState<Record<string,boolean>>({}),[busy,setBusy]=useState<Record<string,boolean>>({});
  const [receipt,setReceipt]=useState<{identity:string;text:string}|null>(null);
  const active=useRef(new Set<string>());
  const reload=useRef<()=>void>(()=>{});
  const current=()=>ownerId(session.getCommandOwner())===identity;
  const refreshFinancial=()=>{if(current())void client.invalidateQueries({queryKey:tradingKeys.account(session.getSnapshot())});};
  async function read(entry:JournalEntry,signal?:AbortSignal) {
    const key=`${identity}:${entry.key}`;if(active.current.has(key)||!current()||ownerId(entry.owner)!==identity)return;
    active.current.add(key);setBusy(values=>({...values,[key]:true}));
    try {
      const result=await session.queryJournalEntry(entry,signal);if(!current()||signal?.aborted)return;
      const settled=commandResultSettled(result);
      setCanResend(values=>({...values,[key]:!settled}));
      if(settled) {
        const status=result.resultKind==="ORDER_CURRENT"?` · 현재 주문 ${orderStatusLabel(result.result.status)}`:" · 영속 원응답 확인";
        setReceipt({identity,text:`${describe(entry)}: 서버 기록을 확인했습니다${status}. 이번 조회는 금융 요청을 실행하지 않았습니다.`});refreshFinancial();
      } else setMessages(values=>({...values,[key]:result.status==="NOT_OBSERVED"?"서버에서 원래 결과를 관측하지 못했습니다. 미접수나 실패가 확정된 것은 아닙니다.":"취소 대상 주문이 현재 미체결 상태입니다. 취소 완료가 확인된 것은 아닙니다."}));
    } catch(error) {if(error instanceof CommandJournalError&&error.code==="RESOLVED")return;if(current()&&!signal?.aborted){setCanResend(values=>({...values,[key]:false}));setMessages(values=>({...values,[key]:error instanceof CommandJournalError?"브라우저의 저장 또는 동시 처리 기능을 확인하지 못했습니다. 안전하지 않은 재전송은 하지 않습니다.":mutationMessage(error)}));}}
    finally {active.current.delete(key);if(current()&&!signal?.aborted){setBusy(values=>({...values,[key]:false}));reload.current();}}
  }
  const readLatest=useEffectEvent(read);
  useEffect(()=>{
    const controller=new AbortController(),seen=new Set<string>();let queued=Promise.resolve();
    const refresh=()=>{
      if(controller.signal.aborted||ownerId(session.getCommandOwner())!==identity)return;
      try {
        const entries=session.readCommandJournal();setView({identity,entries,error:null});
        for(const entry of entries)if(!seen.has(entry.key)){seen.add(entry.key);queued=queued.then(()=>controller.signal.aborted?undefined:readLatest(entry,controller.signal));}
      }catch{setView({identity,entries:[],error:"미확정 거래 기록을 읽을 수 없습니다. 이 계정의 새 금융 요청은 저장·동시 처리 기능이 확인될 때까지 전송하지 않습니다. 다른 계정과 조회 기능은 별개입니다."});}
    };
    reload.current=refresh;
    const storage=(event:StorageEvent)=>{if(isCommandJournalKey(event.key))refresh();};
    window.addEventListener("storage",storage);window.addEventListener(COMMAND_JOURNAL_EVENT,refresh);
    void Promise.resolve().then(refresh);
    return ()=>{controller.abort();window.removeEventListener("storage",storage);window.removeEventListener(COMMAND_JOURNAL_EVENT,refresh);};
  },[session,identity,snapshot.generation]);
  async function resend(entry:JournalEntry) {
    const key=`${identity}:${entry.key}`;if(!canResend[key]||active.current.has(key)||!current()||ownerId(entry.owner)!==identity)return;
    active.current.add(key);setBusy(values=>({...values,[key]:true}));
    try {await session.resendJournalEntry(entry);if(current()){setReceipt({identity,text:`${describe(entry)}: 원래 요청의 서버 응답을 확인했습니다. 현재 자금과 거래 내역을 다시 조회합니다.`});refreshFinancial();}}
    catch(error){if(current())setMessages(values=>({...values,[key]:mutationMessage(error)}));}
    finally {active.current.delete(key);if(current()){setBusy(values=>({...values,[key]:false}));reload.current();}}
  }
  const visible=view.identity===identity?view:null;
  if(!identity||!visible||!visible.entries.length&&!visible.error&&receipt?.identity!==identity)return null;
  return <aside className="trading-section p-4" aria-label="미확정 거래 복구"><h2 className="section-title">미확정 거래 복구</h2>
    {visible.error&&<p role="alert" className="order-warning">{visible.error}</p>}
    {receipt?.identity===identity&&<p role="status">{receipt.text}</p>}
    {visible.entries.map(entry=>{const key=`${identity}:${entry.key}`;return <div key={key} className="mt-3"><p>{describe(entry)}</p><p className="order-input-hint">{new Date(entry.createdAt).toLocaleString("ko-KR")} 저장 · 같은 계정·원래 키·내용만 사용합니다.</p>
      <p role="status">{messages[key]??"먼저 서버에서 기존 결과를 조회합니다. 조회는 주문·청산·재시작을 실행하지 않습니다."}</p>
      <button type="button" className="account-refresh" disabled={busy[key]} onClick={()=>void read(entry)}>서버 결과 조회</button>
      <p className="order-warning">원래 요청을 재전송하면 아직 접수되지 않은 주문·청산·초기화가 실행될 수 있습니다. 새 키는 만들지 않습니다.</p>
      <button type="button" className="account-refresh" disabled={busy[key]||!canResend[key]} onClick={()=>void resend(entry)}>{busy[key]?"확인 중…":"원래 요청 재전송"}</button>
    </div>;})}
  </aside>;
}
