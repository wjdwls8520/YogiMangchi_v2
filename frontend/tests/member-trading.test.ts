import { QueryClient } from "@tanstack/react-query";
import { bindGuestCache } from "../src/features/trading/components/trading-data-provider";
import { tradingKeys } from "../src/features/trading/api/query-keys";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGuestSession } from "../src/features/trading/api/guest-session";
import { mutationMessage } from "../src/features/trading/api/mutation-request";
import { TradingApiError, tradingJson } from "../src/features/trading/api/client";
const origin = "http://localhost:8081", epoch = Date.parse("2026-10-23T00:00:00Z");
const guest = { accountId: 20, accessToken: `guest_${"a".repeat(43)}`, expiresAt: new Date(epoch + 86400000).toISOString() };
const member = { memberId: 1, accessToken: "header.payload.member", expiresAt: new Date(epoch + 900000).toISOString() };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const round = { round: { roundId: 1, currentRound: true, status: "ACTIVE" } };
function memory() {
  const values = new Map([[`yogimangchi.guest.v1:${origin}`, JSON.stringify(guest)]]);
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
test("member account is never implicitly created and Guest remains recoverable after logout", async () => {
  const storage = memory(), calls: string[] = [];
  const session = createGuestSession(origin, () => storage, async (url, options) => {
    const path = new URL(String(url)).pathname; calls.push(`${options?.method} ${path}`);
    assert.equal(new Headers(options?.headers).get("Authorization"), `Bearer ${member.accessToken}`);
    return path.endsWith("rounds/current") ? response(round) : path.endsWith("accounts/member") ? response({ accountId: 21, memberId: 1, status: "ACTIVE", quoteAsset: "USDT", balance: "10000" }) : response({code:"TRADING_ACCOUNT_REQUIRED"}, 409);
  }, () => epoch);
  await session.restore(); const guestSnapshot = session.getSnapshot(); assert.equal(guestSnapshot.accountId, 20);
  session.pauseMemberCheck();
  await session.enterMember(member, () => {});
  assert.equal(session.getSnapshot().mode, "member"); assert.equal(session.getSnapshot().phase, "anonymous");
  assert.equal(calls.some(call => call.startsWith("POST")), false);
  await session.createGuest(); assert.equal(calls.length, 1);
  await Promise.all([session.createMember(), session.createMember()]);
  assert.equal(calls.filter(call => call.startsWith("POST")).length, 1);
  assert.equal(session.getSnapshot().accountId, 21);
  await assert.rejects(session.retryGuest(session.getSnapshot(), "retry-key-123"), error => error instanceof TradingApiError && error.status === 403);
  assert.deepEqual(JSON.parse(storage.getItem(session.storageKey)!), guest);
  session.leaveMember(); await session.restore(); assert.equal(session.getSnapshot().accountId, 20);
  assert.notEqual(session.getSnapshot().generation, guestSnapshot.generation);
});
test("old Guest responses cannot replace a selected member and an old member 401 cannot erase Guest storage", async () => {
  const storage = memory(); let resolveGuest!: (value: Response) => void, resolveMember!: (value: Response) => void, memberReads = 0;
  const session = createGuestSession(origin, () => storage, async (_url, options) => {
    if (String(_url).endsWith("rounds/current")) return response(round);
    const bearer = new Headers(options?.headers).get("Authorization");
    if (bearer?.includes("guest_")) return new Promise(done => { resolveGuest = done; });
    if (memberReads++ === 0) return response({ accountId: 21 });
    return new Promise(done => { resolveMember = done; });
  }, () => epoch);
  await session.restore(); const old = session.read("account/summary", session.getSnapshot(), new AbortController().signal);
  await session.enterMember(member, () => {}); resolveGuest(response({ accountId: 20 }));
  await assert.rejects(old, { name: "AbortError" }); assert.equal(session.getSnapshot().accountId, 21);
  // A request that eventually returns 401 belongs to the old Member epoch.
  const read = session.read("account/summary", session.getSnapshot(), new AbortController().signal);
  session.leaveMember(); await session.restore(); resolveMember(response({}, 401));
  await assert.rejects(read); assert.equal(session.getSnapshot().accountId, 20);
  assert.deepEqual(JSON.parse(storage.getItem(session.storageKey)!), guest);
});
test("JWT rotation preserves member form/cache epoch and does not persist JWT or reopen account", async () => {
  const storage = memory(); let calls = 0;
  const session = createGuestSession(origin, () => storage, async url => { calls++; return response(String(url).endsWith("rounds/current") ? round : { accountId: 21 }); }, () => epoch);
  await session.enterMember(member, () => {}); const before = session.getSnapshot();
  await session.enterMember({ ...member, accessToken: "header.payload.rotated" }, () => {});
  assert.deepEqual(session.getSnapshot(), before); assert.equal(calls, 2);
  assert.equal(storage.getItem(session.storageKey)!.includes("header.payload"), false);
  assert.equal(JSON.stringify(session.getSnapshot()).includes(member.accessToken), false);
});
test("JWT rotation during explicit account creation keeps one request and accepts its result", async () => {
  let finish!: (value: Response) => void, creates = 0, reads = 0;
  const session = createGuestSession(origin, memory, async (_url, options) => {
    if (String(_url).endsWith("rounds/current")) return response(round);
    if (options?.method === "POST") { creates++; return new Promise(done => { finish = done; }); }
    reads++; return response({code:"TRADING_ACCOUNT_REQUIRED"}, 409);
  }, () => epoch);
  await session.enterMember(member, () => {});
  const creating = session.createMember();
  await Promise.resolve();
  await session.enterMember({ ...member, accessToken: "header.payload.rotated" }, () => {});
  finish(response({ accountId: 21, memberId: 1, status: "ACTIVE", quoteAsset: "USDT", balance: "0" }));
  await creating;
  assert.equal(creates, 1); assert.equal(reads, 1);
  assert.equal(session.getSnapshot().accountId, 21);
});
test("a Guest creation response arriving after member selection is never persisted", async () => {
  const storage = memory(); storage.removeItem(`yogimangchi.guest.v1:${origin}`);
  let finish!: (value: Response) => void;
  const session = createGuestSession(origin, () => storage, async (url) => new URL(String(url)).pathname.endsWith("accounts/guest")
    ? new Promise(done => { finish = done; }) : response(String(url).endsWith("rounds/current") ? round : { accountId: 21 }), () => epoch);
  const creating = session.createGuest(); await Promise.resolve();
  await session.enterMember(member, () => {}); finish(response(guest)); await creating;
  assert.equal(session.getSnapshot().accountId, 21);
  assert.equal(storage.getItem(session.storageKey), null);
});


test("only explicit account-required contract offers creation; generic lookup failures never create", async () => {
  for (const status of [401,403,404,409,500,503]) {
    let posts=0;
    const session=createGuestSession(origin,memory,async (_url,options)=>{if(options?.method==="POST")posts++;return response({},status);},()=>epoch);
    await session.enterMember(member,()=>{});
    assert.equal(session.getSnapshot().phase,"error");await session.createMember();assert.equal(posts,0);
  }
});


test("temporary same-member suspension preserves intent epoch and rejects protected reads until restored",async()=>{
 const session=createGuestSession(origin,memory,async url=>String(url).endsWith("rounds/current")?response(round):response({accountId:21}),()=>epoch);
 await session.enterMember(member,()=>{});const before=session.getSnapshot();
 assert.equal(session.suspendMember(member.memberId),true);assert.equal(session.getSnapshot().accountId,before.accountId);
 assert.equal(session.getSnapshot().generation,before.generation);assert.equal(session.getSnapshot().phase,"loading");
 await assert.rejects(session.read("account/summary",before,new AbortController().signal),{name:"AbortError"});
 await session.enterMember({...member,accessToken:"header.payload.rotated"},()=>{});
 assert.equal(session.getSnapshot().phase,"ready");assert.equal(session.getSnapshot().generation,before.generation);
 assert.equal(session.suspendMember(999),false);
 session.leaveMember();await session.restore();assert.notEqual(session.getSnapshot().generation,before.generation);
});

test("late old-token401 cannot invalidate an already rotated member Trading credential",async()=>{
 let rejectOld!:(value:Response)=>void;
 const session=createGuestSession(origin,memory,async (url,options)=>{
  if(String(url).endsWith("rounds/current"))return response(round);
  if(new Headers(options?.headers).get("Authorization")==="Bearer header.payload.member"&&String(url).endsWith("orders/pending"))return new Promise(resolve=>{rejectOld=resolve;});
  return response({accountId:21});
 },()=>epoch);
 await session.enterMember(member,()=>{});const before=session.getSnapshot();
 const old=session.read("account/orders/pending",before,new AbortController().signal);
 await session.enterMember({...member,accessToken:"header.payload.rotated"},()=>{});rejectOld(response({},401));
 await assert.rejects(old);assert.equal(session.getSnapshot().phase,"ready");assert.equal(session.getSnapshot().generation,before.generation);
});


test("current member401 suspends the same intent epoch and only a rotated token can resume it",async()=>{
 let deny=false,refreshes=0;
 const session=createGuestSession(origin,memory,async url=>String(url).endsWith("rounds/current")?response(round):deny?response({},401):response({accountId:21}),()=>epoch);
 await session.enterMember(member,()=>{refreshes++;});const before=session.getSnapshot();deny=true;
 await assert.rejects(session.read("account/summary",before,new AbortController().signal));
 assert.equal(refreshes,1);assert.equal(session.getSnapshot().phase,"loading");assert.equal(session.getSnapshot().generation,before.generation);
 await session.enterMember(member,()=>{});assert.equal(session.getSnapshot().phase,"loading");
 await session.enterMember({...member,accessToken:"header.payload.rotated"},()=>{});
 assert.equal(session.getSnapshot().phase,"ready");assert.equal(session.getSnapshot().generation,before.generation);
});


test("same-owner recovery retains query/intent cache while logout removes the old financial boundary",async()=>{
 const session=createGuestSession(origin,memory,async url=>String(url).endsWith("rounds/current")?response(round):response({accountId:21}),()=>epoch);
 await session.enterMember(member,()=>{});const client=new QueryClient(),unsubscribe=bindGuestCache(client,session),key=tradingKeys.summary(session.getSnapshot());
 try{
  client.setQueryData(key,{owner:21});await client.getMutationCache().build(client,{mutationFn:async()=>"intent"}).execute(undefined);
  session.suspendMember(1);assert.deepEqual(client.getQueryData(key),{owner:21});assert.equal(client.getMutationCache().getAll().length,1);
  await session.enterMember({...member,accessToken:"header.payload.rotated"},()=>{});assert.deepEqual(client.getQueryData(key),{owner:21});
  session.leaveMember();assert.equal(client.getQueryData(key),undefined);assert.equal(client.getMutationCache().getAll().length,0);
 }finally{unsubscribe();client.clear();}
});


test("member creation401 requests auth recovery once and never automatically resubmits the creation", async () => {
  let creates=0, refreshes=0;
  const session=createGuestSession(origin,memory,async (url,options)=>{
    if(options?.method==="POST"){creates++;return response({},401);}
    return response({code:"TRADING_ACCOUNT_REQUIRED"},409);
  },()=>epoch);
  await session.enterMember(member,()=>{refreshes++;});
  await session.createMember();
  assert.equal(creates,1);assert.equal(refreshes,1);assert.equal(session.getSnapshot().phase,"error");
  await session.createMember();await session.restore();
  assert.equal(creates,1);assert.equal(refreshes,1);
  await session.enterMember({...member,accessToken:"header.payload.rotated"},()=>{refreshes++;});
  assert.equal(session.getSnapshot().phase,"anonymous");assert.equal(creates,1);
  await session.createMember();assert.equal(creates,2);
});

test("expired member creation recovers authentication without POST or pretending account absence", async () => {
  let clock=epoch, posts=0, refreshes=0;
  const session=createGuestSession(origin,memory,async (_url,options)=>{if(options?.method==="POST")posts++;return response({code:"TRADING_ACCOUNT_REQUIRED"},409);},()=>clock);
  await session.enterMember(member,()=>{refreshes++;});clock=Date.parse(member.expiresAt);
  await session.createMember();assert.equal(posts,0);assert.equal(refreshes,1);assert.equal(session.getSnapshot().phase,"error");
});

test("late creation401 from a rotated token reconciles by GET and never repeats POST", async () => {
  let finish!:(value:Response)=>void, posts=0;
  const session=createGuestSession(origin,memory,async (url,options)=>{
    if(options?.method==="POST"){posts++;return new Promise(resolve=>{finish=resolve;});}
    const rotated=new Headers(options?.headers).get("Authorization")?.endsWith("rotated");
    return String(url).endsWith("rounds/current")?response(round):rotated?response({accountId:21}):response({code:"TRADING_ACCOUNT_REQUIRED"},409);
  },()=>epoch);
  let refreshes=0;await session.enterMember(member,()=>{refreshes++;});
  const creating=session.createMember();await Promise.resolve();
  await session.enterMember({...member,accessToken:"header.payload.rotated"},()=>{refreshes++;});
  finish(response({},401));await creating;
  assert.equal(posts,1);assert.equal(refreshes,0);assert.equal(session.getSnapshot().phase,"ready");assert.equal(session.getSnapshot().accountId,21);
});


test("persistent Trading401 cannot drive an unbounded Content refresh loop or account POST", async () => {
  let refreshes=0, posts=0;
  const session=createGuestSession(origin,memory,async (_url,options)=>{if(options?.method==="POST")posts++;return response({},401);},()=>epoch);
  await session.enterMember(member,()=>{refreshes++;});assert.equal(refreshes,1);
  await session.enterMember({...member,accessToken:"header.payload.rotated"},()=>{refreshes++;});
  await session.restore();await session.createMember();
  assert.equal(refreshes,1);assert.equal(posts,0);assert.equal(session.getSnapshot().authRequired,true);
});


test("member credential-required401 stays safe and cannot imply account creation", async () => {
  await assert.rejects(tradingJson(origin,"accounts/member",{method:"POST"},async()=>response({code:"MEMBER_CREDENTIAL_REQUIRED",detail:"Bearer secret-token"},401)),error=>{
    assert.ok(error instanceof TradingApiError);assert.equal(error.status,401);assert.equal(error.code,"MEMBER_CREDENTIAL_REQUIRED");
    assert.match(mutationMessage(error),/회원 로그인/);assert.doesNotMatch(JSON.stringify(error)+error.message+mutationMessage(error),/secret-token/);return true;
  });
});


test("late old-token round401 reconciles with the rotated credential without a creation or new refresh", async () => {
  let finish!:(value:Response)=>void, refreshes=0, posts=0;
  const session=createGuestSession(origin,memory,async(url,options)=>{
    if(options?.method==="POST")posts++;
    if(String(url).endsWith("rounds/current")){
      if(new Headers(options?.headers).get("Authorization")?.endsWith("rotated"))return response(round);
      return new Promise(resolve=>{finish=resolve;});
    }
    return response({accountId:21});
  },()=>epoch);
  const loading=session.enterMember(member,()=>{refreshes++;});
  while(!finish)await new Promise(resolve=>setImmediate(resolve));
  await session.enterMember({...member,accessToken:"header.payload.rotated"},()=>{refreshes++;});
  finish(response({},401));await loading;
  assert.equal(session.getSnapshot().phase,"ready");assert.equal(posts,0);assert.equal(refreshes,0);
});
