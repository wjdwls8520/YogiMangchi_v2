"use client";
import { useEffect, useEffectEvent } from "react";
import { useGuestSession } from "../components/trading-data-provider";
import { COMMAND_JOURNAL_EVENT, isCommandJournalKey, type JournalCommand } from "./command-journal";
import { commandResultSettled } from "./command-result";

// A storage event is only a hint. Clear mounted UI intent only after authoritative readback.
export function useJournalResolution(request:{accountId:number|null;key:string;command:JournalCommand}|null,onConfirmed:()=>void) {
  const {session,snapshot}=useGuestSession(),confirmed=useEffectEvent(onConfirmed);
  const key=request?.key,accountId=request?.accountId,command=request?JSON.stringify(request.command):null;
  useEffect(()=>{
    if(!key||!accountId||!command)return;
    const owner=session.getCommandOwner();if(!owner||owner.accountId!==accountId)return;
    const generation=snapshot.generation,controller=new AbortController();let busy=false;
    const check=async()=>{
      if(busy||controller.signal.aborted)return;
      busy=true;
      try {
        const entries=session.readCommandJournal();if(entries.some(entry=>entry.key===key))return;
        const result=await session.queryJournalEntry({owner,key,createdAt:0,command:JSON.parse(command) as JournalCommand},controller.signal,true);
        const current=session.getCommandOwner();
        if(!controller.signal.aborted&&session.getSnapshot().generation===generation&&current?.origin===owner.origin&&current.mode===owner.mode&&current.accountId===owner.accountId&&commandResultSettled(result))confirmed();
      }catch{ /* Missing/corrupt storage or a failed read never confirms a financial result. */ }
      finally{busy=false;}
    };
    const storage=(event:StorageEvent)=>{if(isCommandJournalKey(event.key))void check();};
    const local=()=>void check();
    window.addEventListener("storage",storage);window.addEventListener(COMMAND_JOURNAL_EVENT,local);void check();
    return()=>{controller.abort();window.removeEventListener("storage",storage);window.removeEventListener(COMMAND_JOURNAL_EVENT,local);};
  },[session,snapshot.generation,key,accountId,command]);
}
