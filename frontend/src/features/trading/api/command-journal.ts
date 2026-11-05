import { tradingOrigin } from "./client";
import { mutationRequest, type TradingCommand } from "./mutation-request";
import { stopLossRequest, type StopLossCommand } from "./stop-loss-contract";

export type JournalOwner = { origin: string; mode: "guest" | "member"; accountId: number };
export type JournalCommand = TradingCommand | ({kind:"stopLoss"} & StopLossCommand) | {kind:"guestRetry"} | {kind:"memberRestart"};
export type JournalEntry = { owner:JournalOwner; key:string; createdAt:number; command:JournalCommand };
type JournalStorage = Pick<Storage,"getItem"|"setItem"|"removeItem"|"key"|"length">;
type JournalLock = <T>(name:string, operation:()=>Promise<T>)=>Promise<T>;
export class CommandJournalError extends Error {
  constructor(readonly code:"INVALID"|"STORAGE"|"LOCK_UNSUPPORTED"|"CAPACITY"|"CONFLICT"|"RESOLVED") { super("미확정 거래 기록을 안전하게 확인하지 못했습니다."); this.name="CommandJournalError"; }
}
const prefix="yogimangchi.trading-journal.v1:";
export const COMMAND_JOURNAL_EVENT="yogimangchi:command-journal";
export function isCommandJournalKey(key:string|null) {return key===null||key.startsWith(prefix);}
export const JOURNAL_ACCOUNT_LIMIT=32, JOURNAL_BYTE_LIMIT=256*1024;
const fail=():never=>{throw new CommandJournalError("INVALID");};
function row(value:unknown):Record<string,unknown> {return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:fail();}
function positiveId(value:unknown):number {return typeof value==="number"&&Number.isSafeInteger(value)&&value>0?value:fail();}
function text(value:unknown):string {return typeof value==="string"?value:fail();}
function ownerKey(owner:JournalOwner) {
  if(tradingOrigin(owner.origin)!==owner.origin||!["guest","member"].includes(owner.mode))return fail();
  positiveId(owner.accountId);
  return `${prefix}${encodeURIComponent(owner.origin)}:${owner.mode}:${owner.accountId}`;
}

// Reconstruct only the fields the existing financial endpoint actually accepts.
export function canonicalJournalCommand(value:unknown):JournalCommand {
  try {
    const v=row(value); let result:JournalCommand;
    switch(v.kind) {
      case "open": result={kind:"open",tradingSymbolId:positiveId(v.tradingSymbolId),type:text(v.type) as "MARKET"|"LIMIT",side:text(v.side) as "LONG"|"SHORT",quantity:text(v.quantity),leverage:typeof v.leverage==="number"?v.leverage:fail(),...(v.type==="LIMIT"?{limitPrice:text(v.limitPrice)}:{})};break;
      case "close": result={kind:"close",positionId:positiveId(v.positionId),...(v.quantity===undefined?{}:{quantity:text(v.quantity)})};break;
      case "limitClose": result={kind:"limitClose",positionId:positiveId(v.positionId),limitPrice:text(v.limitPrice),...(v.quantity===undefined?{}:{quantity:text(v.quantity)})};break;
      case "cancel": result={kind:"cancel",orderId:positiveId(v.orderId)};break;
      case "stopLoss": result={kind:"stopLoss",positionId:positiveId(v.positionId),expectedVersion:typeof v.expectedVersion==="number"?v.expectedVersion:fail(),...(v.stopPrice===undefined?{}:{stopPrice:text(v.stopPrice)})};stopLossRequest(result);return result;
      case "guestRetry": return {kind:"guestRetry"};
      case "memberRestart": return {kind:"memberRestart"};
      default:return fail();
    }
    mutationRequest(result); return result;
  } catch {return fail();}
}
const reset=(command:JournalCommand)=>command.kind==="guestRetry"||command.kind==="memberRestart";
export function journalCommandsConflict(a:JournalCommand,b:JournalCommand) {
  if(reset(a)||reset(b))return true;
  if(a.kind==="open"&&b.kind==="open")return a.tradingSymbolId===b.tradingSymbolId&&a.side===b.side;
  if("positionId" in a&&"positionId" in b)return a.positionId===b.positionId;
  return a.kind==="cancel"&&b.kind==="cancel"&&a.orderId===b.orderId;
}
const browserLock:JournalLock=async(name,operation)=>{
  if(typeof navigator==="undefined"||!navigator.locks)throw new CommandJournalError("LOCK_UNSUPPORTED");
  return navigator.locks.request(name,operation);
};

export function createCommandJournal(storage:()=>JournalStorage=()=>window.localStorage,lock:JournalLock=browserLock,now=Date.now) {
  const executing=new Map<string,number>();
  const executionKey=(owner:JournalOwner,key:string)=>`${ownerKey(owner)}:${key}`;
  const notify=()=>{if(typeof window!=="undefined")window.dispatchEvent(new Event(COMMAND_JOURNAL_EVENT));};
  const guarded=<T>(operation:()=>T):T=>{try{return operation();}catch(error){if(error instanceof CommandJournalError)throw error;throw new CommandJournalError("STORAGE");}};
  function read(owner:JournalOwner):JournalEntry[] {
    return guarded(()=>{
      const raw=storage().getItem(ownerKey(owner));if(raw===null)return [];
      if(new TextEncoder().encode(raw).length>JOURNAL_BYTE_LIMIT)throw new CommandJournalError("CAPACITY");
      let parsed:unknown;try{parsed=JSON.parse(raw);}catch{return fail();}
      const envelope=row(parsed);if(envelope.version!==1||Object.keys(envelope).some(field=>!["version","entries"].includes(field))||!Array.isArray(envelope.entries)||envelope.entries.length>JOURNAL_ACCOUNT_LIMIT)return fail();
      const entries=envelope.entries.map(value=>{
        const v=row(value),key=text(v.key),createdAt=v.createdAt,command=canonicalJournalCommand(v.command);
        if(!/^[A-Za-z0-9_-]{8,100}$/.test(key)||typeof createdAt!=="number"||!Number.isSafeInteger(createdAt)||createdAt<0)return fail();
        if(JSON.stringify(command)!==JSON.stringify(v.command)||Object.keys(v).some(field=>!["key","createdAt","command"].includes(field)))return fail();
        if(command.kind==="guestRetry"&&owner.mode!=="guest"||command.kind==="memberRestart"&&owner.mode!=="member")return fail();
        return {owner:{origin:owner.origin,mode:owner.mode,accountId:owner.accountId},key,createdAt,command};
      });
      if(new Set(entries.map(entry=>entry.key)).size!==entries.length)return fail();
      return entries;
    });
  }
  function write(owner:JournalOwner,entries:JournalEntry[]) {
    guarded(()=>{
      const store=storage(),key=ownerKey(owner);
      if(entries.length===0){store.removeItem(key);return;}
      const raw=JSON.stringify({version:1,entries:entries.map(({key,createdAt,command})=>({key,createdAt,command}))});
      let bytes=new TextEncoder().encode(raw).length;
      for(let i=0;i<store.length;i++){const other=store.key(i);if(other&&other!==key&&other.startsWith(prefix))bytes+=new TextEncoder().encode(store.getItem(other)??"").length;}
      if(bytes>JOURNAL_BYTE_LIMIT)throw new CommandJournalError("CAPACITY");
      store.setItem(key,raw);
    });
    notify();
  }
  async function reserveAttempt(owner:JournalOwner,input:JournalCommand,key:string) {
    const command=canonicalJournalCommand(input);
    if(!/^[A-Za-z0-9_-]{8,100}$/.test(key)||command.kind==="guestRetry"&&owner.mode!=="guest"||command.kind==="memberRestart"&&owner.mode!=="member")return fail();
    return lock(ownerKey(owner),async()=>{
      const entries=read(owner),existing=entries.find(entry=>entry.key===key);
      if(existing){if(JSON.stringify(existing.command)!==JSON.stringify(command))throw new CommandJournalError("CONFLICT");return {entry:existing,existed:true};}
      if(entries.some(entry=>journalCommandsConflict(entry.command,command)))throw new CommandJournalError("CONFLICT");
      if(entries.length>=JOURNAL_ACCOUNT_LIMIT)throw new CommandJournalError("CAPACITY");
      const createdAt=now();if(!Number.isSafeInteger(createdAt)||createdAt<0)return fail();
      const entry={owner:{origin:owner.origin,mode:owner.mode,accountId:owner.accountId},key,createdAt,command};write(owner,[...entries,entry]);return {entry,existed:false};
    });
  }
  return {
    read,
    isExecuting(entry:JournalEntry) {return (executing.get(executionKey(entry.owner,entry.key))??0)>0;},
    beginAttempt(owner:JournalOwner,key:string,conceal:boolean) {
      const id=executionKey(owner,key);if(conceal)executing.set(id,(executing.get(id)??0)+1);
      return ()=>{if(conceal){const count=(executing.get(id)??1)-1;if(count>0)executing.set(id,count);else executing.delete(id);}notify();};
    },
    reserveAttempt,
    async reserve(owner:JournalOwner,input:JournalCommand,key:string) {return (await reserveAttempt(owner,input,key)).entry;},
    // The caller must validate a terminal financial response or authoritative FOUND result first.
    async removeConfirmed(entry:JournalEntry) {
      return lock(ownerKey(entry.owner),async()=>{
        const entries=read(entry.owner),current=entries.find(value=>value.key===entry.key);
        if(current&&JSON.stringify(current.command)!==JSON.stringify(entry.command))throw new CommandJournalError("CONFLICT");
        write(entry.owner,entries.filter(value=>value.key!==entry.key));
      });
    },
    async withEntryLock<T>(entry:JournalEntry,operation:(current:JournalEntry)=>Promise<T>) {
      return lock(`${ownerKey(entry.owner)}:${entry.key}`,async()=>{
        const current=read(entry.owner).find(value=>value.key===entry.key);
        if(!current)throw new CommandJournalError("RESOLVED");
        if(JSON.stringify(current.command)!==JSON.stringify(entry.command))throw new CommandJournalError("CONFLICT");
        return operation(current);
      });
    },
    async withResultLock<T>(entry:JournalEntry,operation:()=>Promise<T>) {
      return lock(`${ownerKey(entry.owner)}:${entry.key}`,operation);
    },
  };
}
export type CommandJournal=ReturnType<typeof createCommandJournal>;
