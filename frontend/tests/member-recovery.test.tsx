import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemberSession } from "../src/features/member/api/session";
import { ContentApiError } from "../src/features/member/api/client";
import { MemberTradingPrompt } from "../src/features/trading/components/member-trading-prompt";
import { parseRecovery } from "../src/features/trading/api/recovery-contract";

const epoch=Date.parse("2026-10-26T00:00:00Z");
const json=(value:unknown,status=200)=>Response.json(value,{status});
function fixture() {
  let now=epoch, mode="ok", calls=0, reads=0;
  const session=createMemberSession("http://localhost:8080",async url=>{
    if(String(url).endsWith("csrf"))return json({headerName:"X-CSRF-TOKEN",token:"csrf"});
    if(!String(url).endsWith("refresh")){reads++;return mode==="business503" ? json({code:"SERVICE_TEMPORARILY_UNAVAILABLE"},503) : json({ok:true});}
    calls++;
    if(mode==="network")throw new TypeError("secret-connection-detail");
    if(mode==="503")return json({code:"SERVICE_TEMPORARILY_UNAVAILABLE",detail:"secret"},503);
    if(mode==="401")return json({},401);
    return json({memberId:1,nickname:"테스트",tokenType:"Bearer",accessToken:`header.payload.token${calls}`,expiresIn:900,expiresAt:new Date(now+900000).toISOString()});
  },()=>now,operation=>operation(),()=>true);
  return {session,setMode:(value:string)=>{mode=value;},advance:(ms:number)=>{now+=ms;},calls:()=>calls,reads:()=>reads};
}
test("documented Refresh503 retains valid access/identity and bounds merged retries with cooldown",async()=>{
  const f=fixture();await f.session.restore();const identity=f.session.getSnapshot();f.advance(880000);f.setMode("503");
  await assert.rejects(f.session.refresh());
  assert.equal(f.session.getSnapshot().phase,"ready");assert.equal(f.session.getSnapshot().memberId,1);
  assert.equal(f.session.getSnapshot().generation,identity.generation);
  assert.deepEqual(await f.session.request("/members/me"),{ok:true});assert.equal(f.calls(),2);
  f.advance(1001);await Promise.allSettled([f.session.refresh(),f.session.refresh()]);assert.equal(f.calls(),3);
  f.advance(2001);await assert.rejects(f.session.refresh());assert.equal(f.calls(),4);
  f.advance(9000);await assert.rejects(f.session.refresh());assert.equal(f.calls(),4);
  assert.equal(f.session.getSnapshot().recovery?.retryable,false);
});
test("expired Access pauses protected reads without erasing identity, safe503 can recover",async()=>{
  const f=fixture();await f.session.restore();f.advance(901000);f.setMode("503");
  await assert.rejects(f.session.request("/members/me"));assert.equal(f.reads(),0);
  assert.equal(f.session.getSnapshot().phase,"recovering");assert.equal(f.session.getSnapshot().memberId,1);
  let exposed:unknown="not-called";f.session.observeAccess(access=>{exposed=access;});assert.equal(exposed,null);
  f.advance(1001);f.setMode("ok");await f.session.restore();assert.equal(f.session.getSnapshot().phase,"ready");
  assert.equal(f.session.getSnapshot().recovery,undefined);
});
test("lost rotation response never automatically reuses Refresh; valid Access survives until expiry",async()=>{
  const f=fixture();await f.session.restore();f.setMode("network");await assert.rejects(f.session.refresh());
  assert.equal(f.session.getSnapshot().recovery?.uncertain,true);
  assert.equal(f.session.getSnapshot().phase,"ready");
  f.advance(10000);await assert.rejects(f.session.restore());assert.equal(f.calls(),2);
  f.advance(901000);f.session.checkExpiry();assert.equal(f.session.getSnapshot().phase,"recovering");
  await assert.rejects(f.session.request("/members/me"));assert.equal(f.calls(),2);
  assert.doesNotMatch(JSON.stringify(f.session.getSnapshot()),/header\.payload|secret/);
});
test("confirmed Refresh401 ends identity while a business503 never becomes logout",async()=>{
  const f=fixture();await f.session.restore();f.setMode("business503");
  await assert.rejects(f.session.request("/members/me"),error=>error instanceof ContentApiError&&error.status===503);
  assert.equal(f.session.getSnapshot().phase,"ready");f.setMode("401");await assert.rejects(f.session.refresh());
  assert.equal(f.session.getSnapshot().phase,"anonymous");assert.equal(f.session.getSnapshot().memberId,null);
});
test("consent required, unavailable, checking and session recovery expose distinct next actions",()=>{
  const base={phase:"ready" as const,memberId:1,nickname:"회원",expiresAt:null,generation:1};
  const render=(extra:object)=>renderToStaticMarkup(<MemberTradingPrompt member={{...base,...extra}} retry={()=>{}} retryConsents={()=>{}}/>);
  assert.match(render({consentStatus:"required"}),/필수 정책 확인·동의/);
  assert.match(render({consentStatus:"unavailable"}),/동의 상태를 조회하지 못했습니다/);
  assert.match(render({consentStatus:"checking"}),/로그인 완료/);
  assert.match(render({phase:"recovering"}),/세션 복구 대기/);
});
test("ledger mismatch uses a ledger review explanation, never a fabricated price gap",()=>{
  const value=parseRecovery({status:"REVIEW_REQUIRED",pendingWork:0,heldWork:0,oldestRiskEventId:null,oldestReceivedAt:null,capturedAt:new Date(epoch).toISOString(),holds:[{holdId:1,tradingSymbolId:null,riskEventId:null,heldAt:new Date(epoch).toISOString(),reason:"LEDGER_MISMATCH"}]});
  assert.match(value.holds[0].reason,/금융 원장 불일치/);assert.doesNotMatch(value.holds[0].reason,/가격|시세/);
});


test("an abandoned rotation is fenced across a new page/session without storing credentials",async()=>{
 const values=new Map<string,string>();const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
 let finish!:(value:Response)=>void,calls=0;
 const transport:typeof fetch=async url=>{calls++;return String(url).endsWith("csrf")?json({headerName:"X-CSRF-TOKEN",token:"csrf"}):new Promise(resolve=>{finish=resolve;});};
 const a=createMemberSession("http://localhost:8080",transport,()=>epoch,fn=>fn(),()=>true,()=>storage);
 const pending=a.restore();for(let i=0;i<10;i++)await Promise.resolve();assert.equal(values.size,1);a.forget();
 const b=createMemberSession("http://localhost:8080",transport,()=>epoch,fn=>fn(),()=>true,()=>storage);
 await assert.rejects(b.restore());assert.equal(calls,2);assert.equal(b.getSnapshot().recovery?.uncertain,true);
 finish(json({memberId:1,nickname:"회원",tokenType:"Bearer",accessToken:"header.payload.token",expiresIn:900,expiresAt:new Date(epoch+900000).toISOString()}));
 await assert.rejects(pending,{name:"AbortError"});assert.equal(values.size,1);
 assert.deepEqual([...values.values()],["pending"]);assert.doesNotMatch(JSON.stringify([...values]),/header\.payload|csrf|memberId/);
});

test("documented no-consumption503 releases the shared marker; successful login starts a new safe family",async()=>{
 const values=new Map<string,string>();const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
 let unavailable=true;
 const session=createMemberSession("http://localhost:8080",async url=>String(url).endsWith("csrf")?json({headerName:"X-CSRF-TOKEN",token:"csrf"}):unavailable?json({code:"SERVICE_TEMPORARILY_UNAVAILABLE"},503):json({memberId:1,nickname:"회원",tokenType:"Bearer",accessToken:"header.payload.token",expiresIn:900,expiresAt:new Date(epoch+900000).toISOString()}),()=>epoch,fn=>fn(),()=>true,()=>storage);
 await assert.rejects(session.restore());assert.equal(values.size,0);
 values.set("yogimangchi:content-refresh-pending:http://localhost:8080","pending");unavailable=false;await session.complete();
 assert.equal(session.getSnapshot().phase,"ready");assert.equal(values.size,0);
});
