import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLeverage, leveragePath } from "../src/features/trading/api/leverage-contract";
import { createGuestSession } from "../src/features/trading/api/guest-session";
import { TradingApiError, retryTradingQuery } from "../src/features/trading/api/client";
import { tradingKeys } from "../src/features/trading/api/query-keys";
import { positionValuation } from "../src/features/trading/api/position-display";
import { parsePosition } from "../src/features/trading/api/account";
import { mutationMessage } from "../src/features/trading/api/mutation-request";

const setting = { side: "LONG", tradingSymbolId: 1, leverage: 10, maxLeverage: 100, marginMode: "ISOLATED", marginTransitionStatus:"COMPLETE", updatedAt: null };
const epoch = Date.parse("2026-10-19T00:00:00Z"), origin = "http://trade.example";
function setup(transport: typeof fetch) {
  const values = new Map([[`yogimangchi.guest.v1:${origin}`, JSON.stringify({ accountId: 1,
    accessToken: `guest_${"a".repeat(43)}`, expiresAt: new Date(epoch + 86400000).toISOString() })]]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  return { session: createGuestSession(origin, () => storage, transport, () => epoch), storage };
}

test("leverage contract binds symbol identity, strict integer range and ISOLATED mode", () => {
  assert.deepEqual(parseLeverage(setting, 1), setting);
  assert.equal(parseLeverage({...setting,leverage:100},1).leverage,100);
  for (const changed of [{leverage:101},{leverage:0},{leverage:1.5},{maxLeverage:20,leverage:21},{tradingSymbolId:2},{marginMode:"CROSS"},{updatedAt:"bad"}])
    assert.throws(()=>parseLeverage({...setting,...changed},1));
  assert.throws(()=>leveragePath(0));
});

test("authenticated leverage GET/PUT uses exact contract without order keys, and isolates cache by account/symbol", async () => {
  const calls: {url:string;method:string;body:unknown}[]=[];
  const {session}=setup(async (url, init)=>{
    assert.ok(new Headers(init?.headers).has("Authorization"));
    assert.equal(new Headers(init?.headers).has("Idempotency-Key"),false);
    calls.push({url:String(url),method:init?.method??"GET",body:init?.body ? JSON.parse(String(init.body)) : null});
    return Response.json({...setting,leverage:init?.method==="PUT" ? 100 : 10});
  });
  await session.restore(); const identity=session.getSnapshot();
  assert.equal(parseLeverage(await session.read(leveragePath(1),identity,new AbortController().signal),1).leverage,10);
  assert.equal((await session.changeLeverage(1,100,identity)).leverage,100);
  assert.deepEqual(calls.map(c=>[c.method,c.body]),[["GET",null],["PUT",{side:"LONG",leverage:100}]]);
  assert.equal(calls[1].url,`${origin}/api/v1/trading/account/symbols/1/leverage`);
  await assert.rejects(session.changeLeverage(1,101,identity)); assert.equal(calls.length,2);
  assert.notDeepEqual(tradingKeys.leverage(identity,1),tradingKeys.leverage(identity,2));
  assert.notDeepEqual(tradingKeys.leverage(identity,1),tradingKeys.leverage({...identity,accountId:2},1));
});

test("leverage failures preserve safe codes/status, never retry PUT or leak body credentials", async () => {
  for(const [status,code] of [[409,"INSUFFICIENT_MARGIN"],[409,"LEVERAGE_MISMATCH"],[400,"INVALID_LEVERAGE"],[503,"ENGINE_RECOVERING"]] as const) {
    let calls=0;
    const {session}=setup(async()=>{calls++;return Response.json({code,detail:"Bearer secret-credential",url:"sensitive-url"},{status});});
    await session.restore();
    await assert.rejects(session.changeLeverage(1,14,session.getSnapshot()),error=>{
      assert.ok(error instanceof TradingApiError); assert.equal(error.status,status); assert.equal(error.code,code);
      assert.doesNotMatch(JSON.stringify(error)+error.message+mutationMessage(error),/secret-credential|sensitive-url/);
      if(status<500)assert.equal(retryTradingQuery(0,error),false);
      return true;
    }); assert.equal(calls,1);
  }
});

test("leverage response from an old Guest is discarded, and 401 never silently creates a Guest", async () => {
  let finish!: (value:Response)=>void;
  const {session,storage}=setup(async()=>new Promise(resolve=>{finish=resolve;}));
  await session.restore(); const request=session.changeLeverage(1,14,session.getSnapshot());
  storage.removeItem(session.storageKey); await session.restore(); finish(Response.json({...setting,leverage:14}));
  await assert.rejects(request,{name:"AbortError"});
  let calls=0; const denied=setup(async()=>{calls++;return Response.json({}, {status:401});}).session;
  await denied.restore(); await assert.rejects(denied.changeLeverage(1,14,denied.getSnapshot()));
  assert.equal(denied.getSnapshot().phase,"anonymous"); assert.equal(calls,1);
});

test("updated server margin changes ROE while leverage alone never changes absolute PnL",()=>{
  const position=parsePosition({marginMode:"ISOLATED",openedMarginMode:"ISOLATED",liquidationPrice:null,liquidationPriceStatus:"NO_THRESHOLD",liquidationPriceAsOf:null,id:1,tradingSymbolId:1,side:"LONG",quantity:"2",reservedCloseQuantity:"0",freeCloseQuantity:"2",entryPrice:"100",leverage:10,margin:"20",status:"OPEN",realizedPnl:"0",markPrice:"110",unrealizedPnl:"20",priceStatus:"FRESH",priceEventTime:new Date(epoch).toISOString(),openedAt:new Date(epoch).toISOString()});
  const mark={decimal:"110",value:110,eventTime:epoch,expiresAt:epoch+5000};
  assert.equal(positionValuation(position,mark,epoch).roe,"100");
  const after=positionValuation({...position,leverage:100,margin:"2"},mark,epoch);
  assert.equal(after.pnl,"20"); assert.equal(after.roe,"1000");
});


test("LONG/SHORT settings use separate paths, bodies and caches without overwriting each other", async () => {
  const settings = {LONG:10,SHORT:25};
  const {session} = setup(async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const side: "LONG" | "SHORT" = body?.side ?? new URL(String(url)).searchParams.get("side");
    assert.ok(side === "LONG" || side === "SHORT");
    if (body) settings[side] = body.leverage;
    return Response.json({...setting,side,leverage:settings[side]});
  });
  await session.restore(); const identity=session.getSnapshot();
  await session.changeLeverage(1,100,identity,"LONG");
  assert.equal(settings.SHORT,25);
  assert.equal(parseLeverage(await session.read(leveragePath(1,"SHORT"),identity,new AbortController().signal),1,"SHORT").leverage,25);
  assert.notDeepEqual(tradingKeys.leverage(identity,1,"LONG"),tradingKeys.leverage(identity,1,"SHORT"));
  assert.throws(()=>parseLeverage({...setting,side:"SHORT"},1,"LONG"));
});
