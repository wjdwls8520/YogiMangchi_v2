import { QueryClient } from "@tanstack/react-query";
import { admissionRecheckPending, admissionRejectionKey, reportAdmissionRejection } from "../src/features/trading/api/admission-rejection";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEngine, parseRecovery, recoveryAdmission } from "../src/features/trading/api/recovery-contract";
import { parsePerformance, performancePath } from "../src/features/trading/api/performance";
import { tradingJson, TradingApiError, retryTradingQuery } from "../src/features/trading/api/client";
import { uncertainMutation, mutationMessage, createTradingIntent } from "../src/features/trading/api/mutation-request";
import type { TradingOrder } from "../src/features/trading/api/orders";

const at = "2026-10-24T00:00:00Z", before = "2026-10-25T00:00:00Z";
const clear = {status:"CLEAR",pendingWork:0,heldWork:0,oldestRiskEventId:null,oldestReceivedAt:null,holds:[],capturedAt:at};
test("global readiness and account recovery are independent; only global recovery permits cancel", () => {
  assert.deepEqual(recoveryAdmission(parseEngine({status:"READY"}),parseRecovery(clear)),{trade:true,cancel:true});
  assert.deepEqual(recoveryAdmission("RECOVERING",parseRecovery(clear)),{trade:false,cancel:true});
  for (const state of [undefined,parseRecovery({...clear,status:"PENDING",pendingWork:1}),parseRecovery({...clear,status:"REVIEW_REQUIRED",heldWork:1})])
    assert.deepEqual(recoveryAdmission("READY",state),{trade:false,cancel:false});
  assert.deepEqual(recoveryAdmission(undefined,parseRecovery(clear)),{trade:false,cancel:false});
  assert.throws(()=>parseRecovery({...clear,pendingWork:1}));
  assert.throws(()=>parseRecovery({...clear,pendingWork:-1}));
  assert.throws(()=>parseEngine({status:"FRESH"}));
});
test("recovery scope preserves IDs/timestamps and never exposes internal hold strings", () => {
  const parsed=parseRecovery({...clear,status:"REVIEW_REQUIRED",holds:[{holdId:1,tradingSymbolId:2,riskEventId:3,heldAt:at,reason:"Bearer private-db-error"}]});
  assert.equal(parsed.holds[0].tradingSymbolId,2);
  assert.doesNotMatch(JSON.stringify(parsed),/Bearer|private-db/);
});
test("known NOT_ACCEPTED recovery response is a rejection, while missing/unknown/network outcomes remain uncertain", async () => {
  for (const code of ["ACCOUNT_RISK_PENDING","ACCOUNT_RECOVERY_HELD","ENGINE_RECOVERING"]) {
    await assert.rejects(tradingJson("http://localhost:8081","account/orders",{},async()=>Response.json({code,outcome:"NOT_ACCEPTED",detail:"Bearer private-secret",credential:"private-secret"},{status:503})), error=>{
      assert.ok(error instanceof TradingApiError);assert.equal(uncertainMutation(error),false);
      assert.equal(retryTradingQuery(0,error),true); // GET retry remains bounded independently of mutations.
      assert.doesNotMatch(error.message+JSON.stringify(error)+mutationMessage(error),/private-secret|Bearer/);
      return true;
    });
  }
  for (const error of [new TradingApiError(503),new TradingApiError(500,undefined,undefined,undefined,"UNKNOWN"),new TradingApiError(0),new TradingApiError(422)]) assert.equal(uncertainMutation(error),true);
  const keys:string[]=[];
  const intent=createTradingIntent(async request=>{keys.push(request.key);if(keys.length===1)throw new TradingApiError(503,undefined,"ACCOUNT_RISK_PENDING",undefined,"NOT_ACCEPTED");return {} as TradingOrder;},()=>`key-${keys.length}`);
  const command={kind:"open" as const,tradingSymbolId:1,side:"LONG" as const,type:"MARKET" as const,quantity:"1",leverage:10};
  const session={phase:"ready" as const,accountId:1,generation:1};
  await assert.rejects(intent.execute(command,session)); await intent.execute(command,session);
  assert.notEqual(keys[0],keys[1]);
});

const numbers={fillCount:3,turnover:"999999999999999999.12345678901234567800000001",grossRealizedPnl:"10",fees:"1",settlementAdjustment:"0.01",economicTradingPnl:"9",cashTradingPnl:"9.01"};
const performance={scope:{fromInclusive:at,beforeExclusive:before,roundId:null,tradingSymbolId:null,turnoverDefinition:"internal",unrealizedScope:"CURRENT_OPEN_EXPOSURE"},
  totals:numbers,symbols:[{...numbers,tradingSymbolId:2,symbol:"BTC",quoteAsset:"USDT",turnoverSharePercent:"100",currentUnrealizedPnl:null,valuationStatus:"STALE",priceEventTime:null,priceReceivedAt:null,valuedAt:before}],capitalAdjustment:"10000",roundReturn:null,capturedAt:before};
test("performance uses full server aggregates and exact decimal strings with separate current valuation/capital adjustments", () => {
  const parsed=parsePerformance(performance,{});
  assert.equal(parsed.totals.turnover,numbers.turnover);
  assert.equal(parsed.totals.economicTradingPnl,"9");assert.equal(parsed.totals.cashTradingPnl,"9.01");
  assert.equal(parsed.capitalAdjustment,"10000");assert.equal(parsed.symbols[0].currentUnrealizedPnl,null);
  assert.equal(parsed.scope.fromInclusive,at);
  assert.equal(performancePath({from:at,before,roundId:7}),`account/performance/symbols?from=${encodeURIComponent(at)}&before=${encodeURIComponent(before)}&roundId=7`);
  assert.throws(()=>performancePath({from:before,before:at}));
  for(const value of [{...performance,totals:{...numbers,turnover:1}}, {...performance,symbols:[performance.symbols[0],performance.symbols[0]]}, {...performance,symbols:[{...performance.symbols[0],currentUnrealizedPnl:"0"}]}]) assert.throws(()=>parsePerformance(value,{}));
  assert.throws(()=>parsePerformance(performance,{roundId:7}));
});
test("round return only appears for whole verified scope; legacy and stale values cannot fabricate ROI", () => {
  const scoped={...performance,scope:{...performance.scope,roundId:7},roundReturn:{status:"CURRENT",initialCapital:"10000",capitalAdjustment:"0",cashPerformance:"9",returnPercent:"0.09",valuedAt:before}};
  assert.equal(parsePerformance(scoped,{roundId:7}).roundReturn?.returnPercent,"0.09");
  assert.throws(()=>parsePerformance(scoped,{roundId:7,from:at}));
  assert.throws(()=>parsePerformance({...scoped,roundReturn:{...scoped.roundReturn,status:"LEGACY_UNVERIFIED"}},{roundId:7}));
  assert.equal(parsePerformance({...scoped,roundReturn:{...scoped.roundReturn,status:"LEGACY_UNVERIFIED",initialCapital:null,returnPercent:null,cashPerformance:null,capitalAdjustment:null}},{roundId:7}).roundReturn?.returnPercent,null);
});


test("a quote rejection blocks earlier READY/CLEAR evidence until both scopes are rechecked, without posting orders", () => {
  const client = new QueryClient();
  const session = {phase:"ready" as const,accountId:1,generation:1};
  reportAdmissionRejection(client, session, new TradingApiError(503,undefined,"ENGINE_RECOVERING"));
  const rejection = client.getQueryData<{code:"ENGINE_RECOVERING";at:number}>(admissionRejectionKey(session))!;
  assert.equal(rejection.code,"ENGINE_RECOVERING");
  assert.equal(admissionRecheckPending(rejection,rejection.at-1,rejection.at+1),true);
  assert.equal(admissionRecheckPending(rejection,rejection.at+1,rejection.at-1),true);
  assert.equal(admissionRecheckPending(rejection,rejection.at+1001,rejection.at+1001),false);
  assert.equal(client.getQueryData(admissionRejectionKey({...session,generation:2})),undefined);
  reportAdmissionRejection(client, session, new TradingApiError(409,undefined,"INSUFFICIENT_MARGIN"));
  assert.equal(client.getQueryData(admissionRejectionKey(session)),rejection);
  client.clear();
});
