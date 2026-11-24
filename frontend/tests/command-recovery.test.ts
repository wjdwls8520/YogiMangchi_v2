import { test } from "node:test";
import assert from "node:assert/strict";
import { CommandJournalError, createCommandJournal } from "../src/features/trading/api/command-journal";
import { commandResultRequest, parseCommandResult } from "../src/features/trading/api/command-result";
import { createGuestSession } from "../src/features/trading/api/guest-session";
import { TradingApiError } from "../src/features/trading/api/client";

const origin="http://trade.example",at="2026-11-06T00:00:00Z",epoch=Date.parse(at);
const command={kind:"open" as const,tradingSymbolId:1,type:"MARKET" as const,side:"LONG" as const,quantity:"0.00100000",leverage:3};
const order={orderId:31,positionId:41,tradingSymbolId:1,type:"MARKET",action:"OPEN",side:"LONG",status:"FILLED",quantity:"0.00100000",leverage:3,requestedLeverage:3,feeRate:"0.0003",reservedFee:"0",limitPrice:null,reservedMargin:"0",reservedCloseQuantity:"0",createdAt:at,completedAt:at,reason:null,fill:{fillId:5,quantity:"0.00100000",price:"64000",priceEventTime:at,executedAt:at,realizedPnl:"0",fee:"0.0192",settlementAdjustment:"0",marginMode:"ISOLATED"}};
function environment() {
  const values=new Map<string,string>(),queues=new Map<string,Promise<unknown>>();
  const storage={get length(){return values.size;},key:(i:number)=>[...values.keys()][i]??null,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
  const lock=<T>(name:string,operation:()=>Promise<T>)=>{const next=(queues.get(name)??Promise.resolve()).then(operation);queues.set(name,next.catch(()=>{}));return next;};
  storage.setItem(`yogimangchi.guest.v1:${origin}`,JSON.stringify({accountId:7,accessToken:`guest_${"a".repeat(43)}`,expiresAt:"2099-01-01T00:00:00Z"}));
  return {storage,values,lock,journal:createCommandJournal(()=>storage,lock,()=>epoch)};
}
const found=()=>Response.json({status:"FOUND",operation:"OPEN",observedAt:at,resultKind:"ORDER_CURRENT",result:order});
const absent=()=>Response.json({status:"NOT_OBSERVED",operation:"OPEN",observedAt:at,resultKind:null,result:null});

test("response loss survives reload; authoritative readonly FOUND restores original order without another financial POST",async()=>{
  const e=environment();let writes=0,reads=0;
  const transport:typeof fetch=async(url,init)=>{
    if(String(url).endsWith("command-results/query")){reads++;assert.equal(init?.method,"POST");assert.equal(new Headers(init.headers).has("Idempotency-Key"),false);return found();}
    writes++;assert.equal(e.journal.read({origin,mode:"guest",accountId:7}).length,1,"journal must exist before transport");throw new TypeError("lost response");
  };
  const first=createGuestSession(origin,()=>e.storage,transport,()=>epoch,undefined,e.journal);await first.restore();
  await assert.rejects(first.write(command,first.getSnapshot(),"recover-original-key"),TradingApiError);
  const restored=createGuestSession(origin,()=>e.storage,transport,()=>epoch,undefined,e.journal);await restored.restore();
  assert.equal(writes,1);assert.equal(reads,0);const entries=restored.readCommandJournal();assert.equal(entries.length,1);
  const result=await restored.queryJournalEntry(entries[0]);assert.equal(result.status,"FOUND");assert.equal(result.resultKind,"ORDER_CURRENT");
  assert.equal(writes,1);assert.equal(reads,1);assert.deepEqual(restored.readCommandJournal(),[]);
  const raw=[...e.values.entries()].filter(([key])=>key.startsWith("yogimangchi.trading-journal")).map(([,value])=>value).join("");
  assert.doesNotMatch(raw,/accessToken|guest_aaa|wallet|detail/);
});

test("NOT_OBSERVED is retained; only explicit resend performs the same original key/body after readonly lookup",async()=>{
  const e=environment(),keys:(string|null)[]=[],bodies:unknown[]=[],sequence:string[]=[];
  const transport:typeof fetch=async(url,init)=>{
    if(String(url).endsWith("command-results/query")){sequence.push("read");return absent();}
    sequence.push("write");keys.push(new Headers(init?.headers).get("Idempotency-Key"));bodies.push(JSON.parse(String(init?.body)));
    if(keys.length===1)throw new TypeError("lost response");
    if(keys.length===2)return Response.json({code:"TRADING_BUSY",outcome:"UNKNOWN",attemptOutcome:"NOT_ACCEPTED"},{status:409});
    return Response.json(order);
  };
  const session=createGuestSession(origin,()=>e.storage,transport,()=>epoch,undefined,e.journal);await session.restore();
  await assert.rejects(session.write(command,session.getSnapshot(),"sticky-original-key"));
  const entry=session.readCommandJournal()[0];
  assert.equal((await session.queryJournalEntry(entry)).status,"NOT_OBSERVED");assert.equal(keys.length,1);assert.equal(session.readCommandJournal().length,1);
  await assert.rejects(session.resendJournalEntry(entry));assert.equal(session.readCommandJournal().length,1);
  await session.resendJournalEntry(entry);
  assert.deepEqual(keys,Array(3).fill("sticky-original-key"));assert.ok(bodies.every(body=>JSON.stringify(body)===JSON.stringify(bodies[0])));
  assert.deepEqual(sequence,["write","read","read","write","read","write"]);assert.deepEqual(session.readCommandJournal(),[]);
});

test("blocked storage or a conflicting new key never reaches financial transport",async()=>{
  const e=environment();let writes=0;
  const transport:typeof fetch=async()=>{writes++;throw new TypeError("lost");};
  const session=createGuestSession(origin,()=>e.storage,transport,()=>epoch,undefined,e.journal);await session.restore();
  await assert.rejects(session.write(command,session.getSnapshot(),"first-original-key"));
  await assert.rejects(session.write(command,session.getSnapshot(),"different-new-key"),error=>error instanceof TradingApiError&&error.code==="LOCAL_COMMAND_JOURNAL_BLOCKED");assert.equal(writes,1);
  const blocked=createCommandJournal(()=>{throw new Error("storage forbidden");},async(_name,operation)=>operation());
  const denied=createGuestSession(origin,()=>e.storage,transport,()=>epoch,undefined,blocked);await denied.restore();
  await assert.rejects(denied.write(command,denied.getSnapshot(),"blocked-original-key"),error=>error instanceof TradingApiError&&error.status===409);assert.equal(writes,1);
});

test("query body preserves ALL omission and original SL version; response unions reject mismatched operations/kinds",()=>{
  const base={owner:{origin,mode:"guest" as const,accountId:7},key:"contract-original-key",createdAt:epoch};
  assert.deepEqual(commandResultRequest({...base,command:{kind:"close",positionId:3}}),{operation:"CLOSE",idempotencyKey:base.key,request:{positionId:3}});
  assert.deepEqual(commandResultRequest({...base,command:{kind:"stopLoss",positionId:3,expectedVersion:7}}),{operation:"STOP_LOSS_DELETE",idempotencyKey:base.key,request:{positionId:3,expectedVersion:7}});
  assert.deepEqual(commandResultRequest({...base,command:{kind:"guestRetry"}}),{operation:"GUEST_RETRY",idempotencyKey:base.key});
  const entry={...base,command};
  assert.throws(()=>parseCommandResult({status:"FOUND",operation:"CLOSE",observedAt:at,resultKind:"ORDER_CURRENT",result:order},entry));
  assert.throws(()=>parseCommandResult({status:"FOUND",operation:"OPEN",observedAt:at,resultKind:"ORIGINAL_SNAPSHOT",result:order},entry));
  assert.throws(()=>parseCommandResult({status:"NOT_OBSERVED",operation:"OPEN",observedAt:at,resultKind:null,result:order},entry));
});

test("SL recovery keeps the original PUT/DELETE version and reads the stored snapshot without another mutation",async()=>{
  for(const remove of [false,true]) {
    const e=environment();let writes=0;
    const snapshot={positionId:41,tradingSymbolId:1,side:"LONG",status:remove?"CANCELED":"ACTIVE",stopPrice:"60000",version:2,updatedAt:at,triggeredAt:null,priceEventTime:null,triggerPrice:null,triggerOrderId:null,reason:null};
    const transport:typeof fetch=async(url,init)=>{
      if(String(url).endsWith("command-results/query")) {
        const body=JSON.parse(String(init?.body));assert.equal(body.request.expectedVersion,1);assert.equal(body.request.positionId,41);
        assert.equal(body.operation,remove?"STOP_LOSS_DELETE":"STOP_LOSS_PUT");
        return Response.json({status:"FOUND",operation:body.operation,observedAt:at,resultKind:"ORIGINAL_SNAPSHOT",result:snapshot});
      }
      writes++;assert.equal(init?.method,remove?"DELETE":"PUT");throw new TypeError("lost");
    };
    const session=createGuestSession(origin,()=>e.storage,transport,()=>epoch,undefined,e.journal);await session.restore();
    await assert.rejects(session.writeStopLoss({positionId:41,expectedVersion:1,...(remove?{}:{stopPrice:"60000"})},session.getSnapshot(),"original-sl-key"));
    const restored=createGuestSession(origin,()=>e.storage,transport,()=>epoch,undefined,e.journal);await restored.restore();
    const result=await restored.queryJournalEntry(restored.readCommandJournal()[0]);assert.equal(result.resultKind,"ORIGINAL_SNAPSHOT");assert.equal(writes,1);assert.deepEqual(restored.readCommandJournal(),[]);
  }
});

test("Guest retry reload recovers its receipt without resetting funds again or repeating generation changes",async()=>{
  const e=environment();let writes=0;
  const transport:typeof fetch=async url=>{
    if(String(url).endsWith("command-results/query"))return Response.json({status:"FOUND",operation:"GUEST_RETRY",observedAt:at,resultKind:"ORIGINAL_SNAPSHOT",result:{retryId:2,accountId:7,status:"ACTIVE",quoteAsset:"USDT",balance:"10000",canceledOrderCount:0,closedPositionCount:1,resetAt:at}});
    writes++;throw new TypeError("lost reset response");
  };
  const session=createGuestSession(origin,()=>e.storage,transport,()=>epoch,undefined,e.journal);await session.restore();
  await assert.rejects(session.retryGuest(session.getSnapshot(),"original-retry-key"));
  const restored=createGuestSession(origin,()=>e.storage,transport,()=>epoch,undefined,e.journal);await restored.restore();const entry=restored.readCommandJournal()[0];
  await restored.queryJournalEntry(entry);const generation=restored.getSnapshot().generation;
  await restored.queryJournalEntry(entry,undefined,true);assert.equal(restored.getSnapshot().generation,generation);assert.equal(writes,1);
});

test("member restart recovery reconciles current round rather than restoring the original receipt's older round",async()=>{
  const e=environment();let writes=0;
  const member={memberId:1,accessToken:"fixture.payload.signature",expiresAt:"2099-01-01T00:00:00Z"};
  const transport:typeof fetch=async url=>{
    const path=String(url);
    if(path.endsWith("command-results/query"))return Response.json({status:"FOUND",operation:"MEMBER_RESTART",observedAt:at,resultKind:"ORIGINAL_SNAPSHOT",result:{roundId:2,roundNumber:2,balance:"10000",restartedAt:at,nextAvailableAt:"2026-11-07T00:00:00Z",canceledOrderCount:0,closedPositionCount:1}});
    if(path.endsWith("rounds/current"))return Response.json({round:{roundId:5,currentRound:true,status:"ACTIVE"}});
    if(path.endsWith("account/restart")){writes++;throw new TypeError("lost reset response");}
    return Response.json({accountId:21});
  };
  const session=createGuestSession(origin,()=>e.storage,transport,()=>epoch,undefined,e.journal);await session.enterMember(member,()=>{});
  await assert.rejects(session.restartMember(session.getSnapshot(),"original-restart-key"));
  const restored=createGuestSession(origin,()=>e.storage,transport,()=>epoch,undefined,e.journal);await restored.enterMember(member,()=>{});
  const result=await restored.queryJournalEntry(restored.readCommandJournal()[0]);assert.equal(result.resultKind,"ORIGINAL_SNAPSHOT");assert.equal(restored.getSnapshot().roundId,5);assert.equal(writes,1);
});

test("ordinary in-flight success does not appear as UNKNOWN locally or create an extra cross-tab result query",async()=>{
  const e=environment();let begin!:()=>void,finish!:(response:Response)=>void,reads=0;
  const started=new Promise<void>(resolve=>{begin=resolve;});
  const transport:typeof fetch=async url=>{if(String(url).endsWith("command-results/query")){reads++;return found();}begin();return new Promise(resolve=>{finish=resolve;});};
  const first=createGuestSession(origin,()=>e.storage,transport,()=>epoch,undefined,e.journal);await first.restore();
  const sending=first.write(command,first.getSnapshot(),"ordinary-first-key");await started;assert.deepEqual(first.readCommandJournal(),[]);
  const second=createGuestSession(origin,()=>e.storage,transport,()=>epoch,undefined,createCommandJournal(()=>e.storage,e.lock,()=>epoch));await second.restore();
  const entry=second.readCommandJournal()[0];assert.ok(entry);
  const read=assert.rejects(second.queryJournalEntry(entry));finish(Response.json(order));await sending;await read;
  assert.equal(reads,0);assert.deepEqual(second.readCommandJournal(),[]);
});

test("account switch while waiting for journal reservation prevents the old financial transport",async()=>{
  const e=environment();let entered!:()=>void,release!:()=>void,blocked=false,writes=0;
  const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  const lock=<T>(name:string,operation:()=>Promise<T>)=>e.lock(name,async()=>{if(!blocked&&name.endsWith(":guest:7")){blocked=true;entered();await gate;}return operation();});
  const transport:typeof fetch=async(url,options)=>{
    if(options?.method==="POST"){writes++;return Response.json(order);}
    return String(url).endsWith("rounds/current")?Response.json({round:{roundId:1,status:"ACTIVE",currentRound:true}}):Response.json({accountId:21});
  };
  const session=createGuestSession(origin,()=>e.storage,transport,()=>epoch,undefined,createCommandJournal(()=>e.storage,lock,()=>epoch));await session.restore();
  const sent=session.write(command,session.getSnapshot(),"old-account-key");const rejected=assert.rejects(sent);await started;
  await session.enterMember({memberId:1,accessToken:"fixture.payload.signature",expiresAt:"2099-01-01T00:00:00Z"},()=>{});release();await rejected;
  assert.equal(writes,0);assert.equal(session.getSnapshot().accountId,21);assert.deepEqual(session.readCommandJournal(),[]);
  assert.equal(e.journal.read({origin,mode:"guest",accountId:7}).length,1);
});

test("Guest retry releases its flight/epoch after pre-send storage, lock or conflict failure",async()=>{
  for(const failure of ["storage","lock","conflict"] as const) {
    const e=environment();let blocked=true,writes=0;
    const journal=createCommandJournal(()=>{if(blocked&&failure==="storage")throw new Error("blocked storage");return e.storage;},async(name,operation)=>{if(blocked&&failure==="lock")throw new CommandJournalError("LOCK_UNSUPPORTED");return e.lock(name,operation);},()=>epoch);
    const prior=failure==="conflict"?await e.journal.reserve({origin,mode:"guest",accountId:7},command,"prior-unknown-key"):null;
    const transport:typeof fetch=async()=>{writes++;return Response.json({retryId:2,accountId:7,status:"ACTIVE",quoteAsset:"USDT",balance:"10000",canceledOrderCount:0,closedPositionCount:0,resetAt:at});};
    const session=createGuestSession(origin,()=>e.storage,transport,()=>epoch,undefined,journal);await session.restore();
    await assert.rejects(session.retryGuest(session.getSnapshot(),"pre-send-retry-key"));
    assert.equal(writes,0);assert.equal(session.getSnapshot().retrying,undefined);assert.equal(session.getSnapshot().phase,"ready");
    blocked=false;if(prior)await e.journal.removeConfirmed(prior);
    await session.retryGuest(session.getSnapshot(),"next-normal-retry-key");assert.equal(writes,1);assert.equal(session.getSnapshot().retrying,undefined);
  }
});

test("cached Guest retry and member restart FOUND shortcuts clear retrying without entering financial callbacks",async()=>{
  for(const mode of ["guest","member"] as const) {
    const e=environment();let writes=0,reads=0;
    const receipt=mode==="guest"?{retryId:2,accountId:7,status:"ACTIVE",quoteAsset:"USDT",balance:"10000",canceledOrderCount:0,closedPositionCount:0,resetAt:at}:{roundId:2,roundNumber:2,balance:"10000",restartedAt:at,nextAvailableAt:"2026-11-07T00:00:00Z",canceledOrderCount:0,closedPositionCount:0};
    const transport:typeof fetch=async(url,options)=>{
      if(String(url).endsWith("command-results/query")){reads++;return Response.json({status:"FOUND",operation:mode==="guest"?"GUEST_RETRY":"MEMBER_RESTART",observedAt:at,resultKind:"ORIGINAL_SNAPSHOT",result:receipt});}
      if(options?.method==="POST"){writes++;return Response.json(receipt);}
      return String(url).endsWith("rounds/current")?Response.json({round:{roundId:2,status:"ACTIVE",currentRound:true}}):Response.json({accountId:21});
    };
    const session=createGuestSession(origin,()=>e.storage,transport,()=>epoch,undefined,e.journal);
    if(mode==="guest")await session.restore();else await session.enterMember({memberId:1,accessToken:"fixture.payload.signature",expiresAt:"2099-01-01T00:00:00Z"},()=>{});
    await e.journal.reserve(session.getCommandOwner()!,mode==="guest"?{kind:"guestRetry"}:{kind:"memberRestart"},"cached-reset-original-key");
    if(mode==="guest")await session.retryGuest(session.getSnapshot(),"cached-reset-original-key");else await session.restartMember(session.getSnapshot(),"cached-reset-original-key");
    assert.equal(writes,0);assert.equal(reads,1);assert.equal(session.getSnapshot().retrying,undefined);assert.equal(session.getSnapshot().phase,"ready");assert.deepEqual(session.readCommandJournal(),[]);
  }
});

test("member restart pre-send storage failure releases both flight and tentative key for a normal later request",async()=>{
  const e=environment();let blocked=true,writes=0;
  const journal=createCommandJournal(()=>{if(blocked)throw new Error("blocked");return e.storage;},e.lock,()=>epoch);
  const transport:typeof fetch=async(url,options)=>{
    if(options?.method==="POST"){writes++;return Response.json({roundId:2,roundNumber:2,balance:"10000",restartedAt:at,nextAvailableAt:"2026-11-07T00:00:00Z",canceledOrderCount:0,closedPositionCount:0});}
    return String(url).endsWith("rounds/current")?Response.json({round:{roundId:writes?2:1,status:"ACTIVE",currentRound:true}}):Response.json({accountId:21});
  };
  const session=createGuestSession(origin,()=>e.storage,transport,()=>epoch,undefined,journal);await session.enterMember({memberId:1,accessToken:"fixture.payload.signature",expiresAt:"2099-01-01T00:00:00Z"},()=>{});
  await assert.rejects(session.restartMember(session.getSnapshot(),"blocked-restart-key"));assert.equal(writes,0);assert.equal(session.getSnapshot().retrying,undefined);assert.equal(session.getSnapshot().phase,"ready");
  blocked=false;await session.restartMember(session.getSnapshot(),"next-normal-restart-key");assert.equal(writes,1);assert.equal(session.getSnapshot().retrying,undefined);
});
