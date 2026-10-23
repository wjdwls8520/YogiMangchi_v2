import { test } from "node:test";
import assert from "node:assert/strict";
import { createGuestSession } from "../src/features/trading/api/guest-session";
import { parseGuestRetry } from "../src/features/trading/api/guest-retry";
import { TradingApiError } from "../src/features/trading/api/client";

const guest={accountId:7,status:"ACTIVE",quoteAsset:"USDT",initialBalance:"10000",accessToken:`guest_${"a".repeat(43)}`,tokenType:"Bearer",expiresAt:"2099-01-01T00:00:00Z"};
const response={retryId:2,accountId:7,status:"ACTIVE",quoteAsset:"USDT",balance:"10000.000000000000000000",canceledOrderCount:1,closedPositionCount:2,resetAt:"2026-10-22T00:00:00Z"};
function setup(transport:typeof fetch){
  const data=new Map<string,string>();
  const session=createGuestSession("http://trade.example",()=>({getItem:key=>data.get(key)??null,setItem:(key,value)=>{data.set(key,value);},removeItem:key=>{data.delete(key);}}),transport);
  data.set(session.storageKey,JSON.stringify({accountId:guest.accountId,accessToken:guest.accessToken,expiresAt:guest.expiresAt}));
  return {session,data};
}
test("retry resets the cache epoch, preserves credentials and shares concurrent requests without a body",async()=>{
  let resolve!:(value:Response)=>void,calls=0;
  const {session,data}=setup(async(url,options)=>{
    calls++;assert.equal(String(url),"http://trade.example/api/v1/trading/account/retry");
    const headers=new Headers(options?.headers);assert.equal(headers.get("Idempotency-Key"),"retry-key-123");
    assert.equal(headers.get("Authorization"),`Bearer ${guest.accessToken}`);assert.equal(options?.body,undefined);
    return new Promise<Response>(done=>{resolve=done;});
  });
  await session.restore();const before=session.getSnapshot(),saved=data.get(session.storageKey);
  const first=session.retryGuest(before,"retry-key-123"),second=session.retryGuest(before,"retry-key-123");
  assert.equal(first,second);assert.equal(calls,1);assert.equal(session.getSnapshot().retrying,true);
  await assert.rejects(session.read("account/summary",before,new AbortController().signal),{name:"AbortError"});
  await assert.rejects(session.write({kind:"cancel",orderId:1},session.getSnapshot(),"key"),error=>error instanceof TradingApiError&&error.code==="TRADING_BUSY");
  resolve(Response.json(response));assert.deepEqual(await first,parseGuestRetry(response,7));
  const after=session.getSnapshot();assert.equal(after.accountId,7);assert.ok(after.generation>before.generation);assert.equal(after.retrying,undefined);
  assert.equal(data.get(session.storageKey),saved);assert.ok(!JSON.stringify(after).includes(guest.accessToken));
  await assert.rejects(session.read("account/summary",before,new AbortController().signal),{name:"AbortError"});
});
test("late pre-reset reads are discarded and uncertain retry is explicitly repeated with the same key",async()=>{
  let finishRead!:(value:Response)=>void;const keys:string[]=[];
  const {session}=setup(async(url,options)=>{
    if(String(url).endsWith("/summary"))return new Promise<Response>(resolve=>{finishRead=resolve;});
    keys.push(new Headers(options?.headers).get("Idempotency-Key")!);
    return keys.length===1 ? new Response("",{status:503}) : Response.json(response);
  });
  await session.restore();const old=session.getSnapshot();
  const read=session.read("account/summary",old,new AbortController().signal);
  await assert.rejects(session.retryGuest(old,"same-retry-key"),error=>error instanceof TradingApiError&&error.status===503);
  finishRead(Response.json({balance:"old"}));await assert.rejects(read,{name:"AbortError"});
  assert.equal(keys.length,1);
  await session.retryGuest(session.getSnapshot(),"same-retry-key");assert.deepEqual(keys,["same-retry-key","same-retry-key"]);
});
test("reset rejects malformed snapshots and 401 clears the existing Guest without creating another",async()=>{
  for(const patch of [{accountId:8},{balance:10000},{canceledOrderCount:-1},{closedPositionCount:0.5},{status:"BANKRUPT"},{resetAt:"bad"}])assert.throws(()=>parseGuestRetry({...response,...patch},7));
  let calls=0;const {session,data}=setup(async()=>{calls++;return new Response("",{status:401});});
  await session.restore();await assert.rejects(session.retryGuest(session.getSnapshot(),"retry-key-401"));
  assert.equal(session.getSnapshot().phase,"anonymous");assert.equal(data.get(session.storageKey),undefined);assert.equal(calls,1);
});
test("reset cannot overtake an in-flight financial write and never sends an invalid key",async()=>{
  let finish!:(value:Response)=>void,calls=0;const {session}=setup(async()=>{calls++;return new Promise<Response>(resolve=>{finish=resolve;});});
  await session.restore();const snapshot=session.getSnapshot();
  await assert.rejects(session.retryGuest(snapshot,"bad"));assert.equal(calls,0);
  const write=session.write({kind:"cancel",orderId:1},snapshot,"unused");
  await assert.rejects(session.retryGuest(snapshot,"retry-key-123"),error=>error instanceof TradingApiError&&error.code==="TRADING_BUSY");
  assert.equal(calls,1);finish(new Response("",{status:409}));await assert.rejects(write);
});
