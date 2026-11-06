import { test } from "node:test";
import assert from "node:assert/strict";
import { CommandJournalError, createCommandJournal, JOURNAL_ACCOUNT_LIMIT, JOURNAL_BYTE_LIMIT, type JournalCommand, type JournalOwner } from "../src/features/trading/api/command-journal";

const owner:JournalOwner={origin:"http://localhost:18091",mode:"guest",accountId:7};
const command:JournalCommand={kind:"open",tradingSymbolId:1,type:"LIMIT",side:"LONG",quantity:"0.00100000",leverage:3,limitPrice:"64000.000000000000000001"};
function environment() {
  const values=new Map<string,string>(),queues=new Map<string,Promise<unknown>>();
  const storage={get length(){return values.size;},key:(i:number)=>[...values.keys()][i]??null,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
  const lock=<T>(key:string,operation:()=>Promise<T>)=>{const next=(queues.get(key)??Promise.resolve()).then(operation);queues.set(key,next.catch(()=>{}));return next;};
  return {values,storage,lock};
}
test("journal is saved before transmission, reload reads original canonical decimals/key without executing",async()=>{
  const e=environment();let now=1_000,transmissions=0;
  const journal=createCommandJournal(()=>e.storage,e.lock,()=>now);
  const entry=await journal.reserve(owner,{...command,accessToken:"must-not-persist",wallet:{balance:"secret"}} as JournalCommand,"original-key-0001");
  assert.equal(e.values.size,1);assert.doesNotMatch([...e.values.values()].join(""),/accessToken|must-not-persist|wallet|secret/);
  await journal.withEntryLock(entry,async saved=>{assert.deepEqual(saved.command,command);transmissions++;});
  now+=365*86400000;
  const reloaded=createCommandJournal(()=>e.storage,e.lock,()=>now);
  assert.deepEqual(reloaded.read(owner),[entry]);assert.equal(transmissions,1,"restoring/aging a journal must not transmit or discard it");
  assert.deepEqual(await reloaded.reserve(owner,command,entry.key),entry);
});
test("same-origin tab reservation is atomic and only conflicting scopes are blocked",async()=>{
  const e=environment(),a=createCommandJournal(()=>e.storage,e.lock),b=createCommandJournal(()=>e.storage,e.lock);
  const attempts=await Promise.allSettled([a.reserve(owner,command,"tab-a-key-0001"),b.reserve(owner,command,"tab-b-key-0001")]);
  assert.equal(attempts.filter(x=>x.status==="fulfilled").length,1);assert.equal(a.read(owner).length,1);
  await b.reserve(owner,{...command,side:"SHORT"},"other-side-key");
  await b.reserve(owner,{kind:"close",positionId:9,quantity:"0.001"},"close-position-9");
  await assert.rejects(a.reserve(owner,{kind:"stopLoss",positionId:9,expectedVersion:1,stopPrice:"60000"},"sl-position-9"),error=>error instanceof CommandJournalError&&error.code==="CONFLICT");
  await a.reserve(owner,{kind:"cancel",orderId:11},"cancel-order-11");
  await assert.rejects(a.reserve(owner,{kind:"guestRetry"},"reset-account-7"),CommandJournalError);
});
test("cross-tab recovery serializes a key and completed cleanup cannot cause another POST",async()=>{
  const e=environment(),a=createCommandJournal(()=>e.storage,e.lock),b=createCommandJournal(()=>e.storage,e.lock);
  const entry=await a.reserve(owner,command,"recover-key-0001");let writes=0;
  const first=a.withEntryLock(entry,async current=>{writes++;await a.removeConfirmed(current);return "FOUND";});
  const second=b.withEntryLock(entry,async()=>{writes++;return "must not run";});
  assert.equal(await first,"FOUND");await assert.rejects(second,error=>error instanceof CommandJournalError&&error.code==="RESOLVED");
  assert.equal(writes,1);assert.deepEqual(b.read(owner),[]);
});
test("account, mode and API origin isolation survive re-login without migrating commands",async()=>{
  const e=environment(),journal=createCommandJournal(()=>e.storage,e.lock);
  const entry=await journal.reserve(owner,command,"isolated-key-001");
  for(const other of [{...owner,accountId:8},{...owner,mode:"member" as const},{...owner,origin:"http://localhost:18081"}])assert.deepEqual(journal.read(other),[]);
  assert.deepEqual(createCommandJournal(()=>e.storage,e.lock).read({...owner}),[entry]);
  await assert.rejects(journal.reserve(owner,{kind:"memberRestart"},"wrong-mode-key"),CommandJournalError);
});
test("capacity and corrupted storage never evict UNKNOWN or silently allow a new request",async()=>{
  const e=environment(),journal=createCommandJournal(()=>e.storage,e.lock);
  for(let i=0;i<JOURNAL_ACCOUNT_LIMIT;i++)await journal.reserve(owner,{...command,tradingSymbolId:i+1},`capacity-key-${i}`);
  await assert.rejects(journal.reserve(owner,{...command,tradingSymbolId:100},"over-capacity-key"),error=>error instanceof CommandJournalError&&error.code==="CAPACITY");
  assert.equal(journal.read(owner).length,32);
  const key=[...e.values.keys()][0],raw=e.values.get(key)!;
  e.values.set(key,"{broken secret-credential");assert.throws(()=>journal.read(owner),CommandJournalError);
  await assert.rejects(journal.reserve(owner,{kind:"cancel",orderId:1},"corrupted-key-001"),CommandJournalError);
  assert.equal(e.values.get(key),"{broken secret-credential");
  e.values.set(key,raw);const parsed=JSON.parse(raw);parsed.entries[0].command.quantity="NaN";e.values.set(key,JSON.stringify(parsed));
  assert.throws(()=>journal.read(owner),CommandJournalError);
});
test("global byte budget and storage/lock failures stop before any financial transmission",async()=>{
  const e=environment(),journal=createCommandJournal(()=>e.storage,e.lock);let transmitted=0;
  e.values.set("yogimangchi.trading-journal.v1:other:guest:99","x".repeat(JOURNAL_BYTE_LIMIT));
  await assert.rejects(journal.reserve(owner,command,"byte-limit-key"),CommandJournalError);assert.equal(e.values.size,1);
  const blocked=createCommandJournal(()=>{throw new Error("secret-credential");},e.lock);
  try{const entry=await blocked.reserve(owner,command,"blocked-storage-key");await blocked.withEntryLock(entry,async()=>{transmitted++;});}catch(error){assert.ok(error instanceof CommandJournalError);assert.doesNotMatch(String(error),/secret-credential/);}
  const unsupported=createCommandJournal(()=>e.storage,async()=>{throw new CommandJournalError("LOCK_UNSUPPORTED");});
  await assert.rejects(unsupported.reserve(owner,command,"unsupported-key"),error=>error instanceof CommandJournalError&&error.code==="LOCK_UNSUPPORTED");
  assert.equal(transmitted,0);
});
