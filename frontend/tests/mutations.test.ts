import { test } from "node:test";
import assert from "node:assert/strict";
import { createTradingIntent, mutationMessage, mutationRequest, mutationStillUnconfirmed, tradingSubmissionAllowed, uncertainMutation, type TradingCommand } from "../src/features/trading/api/mutation-request";
import { createGuestSession } from "../src/features/trading/api/guest-session";
import { TradingApiError, tradingJson } from "../src/features/trading/api/client";
import { estimatedOrder, ratioQuantity, validQuantity, validLimitPrice } from "../src/features/trading/api/order-input";
import { parseOrder } from "../src/features/trading/api/orders";
import { MutationObserver, QueryClient, QueryObserver } from "@tanstack/react-query";
import { tradingMutationEffects } from "../src/features/trading/api/mutations";
import { tradingKeys } from "../src/features/trading/api/query-keys";

const snapshot = { phase: "ready" as const, accountId: 7, generation: 1 };
const command: TradingCommand = { kind: "open", type: "MARKET", side: "LONG", tradingSymbolId: 927, quantity: "0.00100000", leverage: 10 };
const response = { orderId: 3, positionId: 4, tradingSymbolId: 927, type: "MARKET", action: "OPEN", side: "LONG", status: "FILLED", quantity: "0.00100000", leverage: 10, requestedLeverage: 10, feeRate:"0.0005",reservedFee:"0", limitPrice: null, reservedMargin: "0", reservedCloseQuantity: "0", createdAt: "2026-10-13T00:00:00Z", completedAt: "2026-10-13T00:00:00Z", reason: null, fill: { fillId: 5, quantity: "0.00100000", price: "64000.000000000000000001", priceEventTime: "2026-10-13T00:00:00Z", executedAt: "2026-10-13T00:00:00Z", realizedPnl: "0",fee:"0",settlementAdjustment:"0",marginMode:"ISOLATED" } };

test("confirmed REST result waits for financial reads but not unrelated slow history or performance", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const releases = new Map<string, () => void>();
  const keys = [tradingKeys.summary(snapshot), tradingKeys.pending(snapshot), [...tradingKeys.account(snapshot), "recovery"],
    [...tradingKeys.account(snapshot), "history-page", "orders"], [...tradingKeys.account(snapshot), "symbol-performance"]];
  const observers = keys.map(queryKey => new QueryObserver(client, {queryKey, initialData: "before", staleTime: Infinity,
    queryFn: () => new Promise<string>(resolve => releases.set(String(queryKey[3]), () => resolve("server-after"))) }));
  const unsubscribes = observers.map(observer => observer.subscribe(() => {}));
  let notifications = 0, writes = 0;
  const mutation = new MutationObserver(client, { retry: false, mutationFn: async () => { writes++; return parseOrder(response); },
    ...tradingMutationEffects(client, {getSnapshot: () => snapshot}), onSuccess: () => { notifications++; } });
  const execution = mutation.mutate({command, session: snapshot});
  const turn = () => new Promise<void>(resolve => setImmediate(resolve));
  try {
    await turn();
    assert.equal(notifications, 1, "the confirmed REST notification already precedes settlement");
    assert.equal(mutation.getCurrentResult().isPending, true);
    assert.equal(releases.size, 5, "all active account datasets still refresh");
    releases.get("summary")!(); releases.get("pending")!();
    await turn();
    assert.equal(mutation.getCurrentResult().isPending, true, "recovery confirmation still locks the request");
    releases.get("recovery")!();
    await turn();
    assert.equal(mutation.getCurrentResult().isSuccess, true, "slow history must not delay the confirmed result");
    assert.equal(observers[3].getCurrentResult().isFetching, true);
    assert.equal(observers[4].getCurrentResult().isFetching, true);
    assert.equal((await execution).orderId, response.orderId);
    assert.equal(writes, 1);
    assert.equal(client.getQueryData(tradingKeys.summary(snapshot)), "server-after", "no optimistic wallet values");
  } finally {
    releases.forEach(release => release());
    await execution;
    unsubscribes.forEach(unsubscribe => unsubscribe()); client.clear();
  }
});

test("mutation payloads match OPEN, CLOSE, LIMIT CLOSE and CANCEL without client execution prices", () => {
  assert.deepEqual(mutationRequest({ ...command, limitPrice: "wrong-unused-value" }), { path: "account/orders", body: { type: "MARKET", side: "LONG", tradingSymbolId: 927, quantity: "0.00100000", leverage: 10 }, keyed: true });
  const limit = mutationRequest({ ...command, type: "LIMIT", limitPrice: "63000.000000000000000001" });
  assert.equal(limit.body?.limitPrice, "63000.000000000000000001");
  assert.deepEqual(mutationRequest({ kind: "close", positionId: 4 }), { path: "account/positions/4/close", body: {}, keyed: true });
  assert.deepEqual(mutationRequest({ kind: "limitClose", positionId: 4, quantity: "0.0005", limitPrice: "65000" }), { path: "account/positions/4/close-orders", body: { quantity: "0.0005", limitPrice: "65000" }, keyed: true });
  assert.deepEqual(mutationRequest({ kind: "cancel", orderId: 3 }), { path: "account/orders/3/cancel", body: undefined, keyed: false });
});
test("input validation and estimates never round financial strings through Number", () => {
  for (const value of ["0", "-1", "NaN", "1e-8", "0.000000001", "1000000000001"]) assert.equal(validQuantity(value), false);
  assert.equal(validQuantity("0.00000001"), true);
  assert.equal(validLimitPrice("64000.000000000000000001"), true);
  assert.equal(validLimitPrice("0.0000000000000000001"), false);
  assert.deepEqual(estimatedOrder("1", "64000.000000000000000001", 1), { notional: "64000.000000000000000001", margin: "64000.000000000000000001" });
  assert.equal(ratioQuantity("10000", "64000", 10, 25), "0.390625");
  assert.equal(ratioQuantity("1", "3", 1, 100), "0.33333333");
  assert.equal(ratioQuantity(null, "3", 1, 100), "");
  assert.throws(() => mutationRequest({ ...command, leverage: 101 }));
  assert.throws(() => mutationRequest({ ...command, quantity: "0.000000001" }));
});
test("double clicks share one in-flight order and use one idempotency key", async () => {
  let finish!: (value: ReturnType<typeof parseOrder>) => void; let calls = 0;
  const intent = createTradingIntent(async (request) => { calls++; assert.equal(request.key, "order-key-0001"); return new Promise((resolve) => { finish = resolve; }); }, () => "order-key-0001");
  const first = intent.execute(command, snapshot); const second = intent.execute(command, snapshot);
  assert.equal(first, second); assert.equal(calls, 1);
  finish(parseOrder(response)); await first;
});
test("uncertain result has no automatic retry and explicit retry preserves key, payload and identity", async () => {
  const requests: { key: string; command: TradingCommand }[] = []; let keys = 0;
  const intent = createTradingIntent(async (request) => { requests.push(request); if (requests.length === 1) throw new TradingApiError(0); return parseOrder(response); }, () => `order-key-${++keys}`);
  await assert.rejects(intent.execute(command, snapshot)); assert.equal(requests.length, 1);
  await assert.rejects(intent.execute({ ...command, side: "SHORT" }, snapshot)); assert.equal(requests.length, 1);
  await intent.execute(command, snapshot);
  assert.equal(requests[0].key, requests[1].key); assert.deepEqual(requests[0].command, requests[1].command); assert.equal(keys, 1);
  await intent.execute(command, snapshot); assert.equal(keys, 2);
});
test("known business rejection permits a new intent without GET-style automatic retries", async () => {
  let keys = 0; let calls = 0;
  const intent = createTradingIntent(async () => { calls++; throw new TradingApiError(409, undefined, "INSUFFICIENT_MARGIN"); }, () => `order-key-${++keys}`);
  await assert.rejects(intent.execute(command, snapshot)); assert.equal(calls, 1);
  await assert.rejects(intent.execute(command, snapshot)); assert.equal(keys, 2);
  assert.equal(mutationMessage(new TradingApiError(409, "never use this server message", "INSUFFICIENT_MARGIN")), "증거금과 수수료를 위한 잔액이 부족합니다.");
});

test("UNKNOWN remains sticky through busy/recovery and repeated lost responses until the same-key result arrives", async () => {
  for (const rejection of [new TradingApiError(409, undefined, "TRADING_BUSY"), new TradingApiError(503, undefined, "ENGINE_RECOVERING", undefined, "NOT_ACCEPTED")]) {
    const requests: {key:string;command:TradingCommand}[] = []; let keys=0;
    const intent=createTradingIntent(async request=>{
      requests.push(request);
      if(requests.length===1||requests.length===3)throw new TradingApiError(0);
      if(requests.length===2)throw rejection;
      return parseOrder(response);
    },()=>`fixture-key-${++keys}`);
    for(let attempt=0;attempt<3;attempt++) {
      await assert.rejects(intent.execute(command,snapshot));
      const retained=intent.getUnconfirmed(snapshot); assert.ok(retained);
      assert.equal(retained.key,"fixture-key-1"); assert.deepEqual(retained.command,command);
      assert.equal(tradingSubmissionAllowed(command,retained,false,true),false,"normal CTA cannot submit a new intent");
      assert.equal(tradingSubmissionAllowed(command,retained,true,false),true,"same-request confirmation remains available during admission hold");
      assert.equal(tradingSubmissionAllowed({...command,side:"SHORT"},retained,true,true),false);
      await assert.rejects(intent.execute({...command,side:"SHORT"},snapshot));
      assert.equal(requests.length,attempt+1);
    }
    await intent.execute(command,snapshot);
    assert.deepEqual(requests.map(x=>x.key),Array(4).fill("fixture-key-1")); assert.equal(keys,1);
    assert.ok(requests.every(x=>JSON.stringify(x.command)===JSON.stringify(command)));
    assert.equal(intent.getUnconfirmed(snapshot),null);
    await intent.execute(command,snapshot); assert.equal(keys,2);
  }
});

test("first definitive rejection stays retryable but explicit UNKNOWN overrides even a 4xx status", async () => {
  for(const error of [new TradingApiError(409,undefined,"TRADING_BUSY"),new TradingApiError(503,undefined,"ENGINE_RECOVERING",undefined,"NOT_ACCEPTED")]) {
    let keys=0; const intent=createTradingIntent(async()=>{throw error;},()=>`first-rejected-${++keys}`);
    await assert.rejects(intent.execute(command,snapshot)); assert.equal(intent.getUnconfirmed(snapshot),null);
    await assert.rejects(intent.execute(command,snapshot)); assert.equal(keys,2);
    assert.equal(mutationStillUnconfirmed(error,true),true);
  }
  assert.equal(uncertainMutation(new TradingApiError(409,undefined,"TRADING_BUSY",undefined,"UNKNOWN")),true);
});

test("verified attempt rejection releases only a first attempt; prior UNKNOWN keeps its original key",async()=>{
  for(const [status,code] of [[409,"TRADING_BUSY"],[503,"ENGINE_RECOVERING"]] as const) {
    let error!:TradingApiError;
    try {await tradingJson("http://trade.example","account/orders",{},async()=>Response.json({code,outcome:"UNKNOWN",attemptOutcome:"NOT_ACCEPTED",detail:"secret-credential"},{status}));}
    catch(value){assert.ok(value instanceof TradingApiError);error=value;}
    assert.equal(error.outcome,"UNKNOWN");assert.equal(error.attemptOutcome,"NOT_ACCEPTED");
    assert.equal(uncertainMutation(error),false);assert.equal(mutationStillUnconfirmed(error,true),true);
    let keys=0,calls=0;
    const first=createTradingIntent(async()=>{throw error;},()=>`attempt-key-${++keys}`);
    await assert.rejects(first.execute(command,snapshot));assert.equal(first.getUnconfirmed(snapshot),null);
    await assert.rejects(first.execute(command,snapshot));assert.equal(keys,2);
    const sent:string[]=[];
    const sticky=createTradingIntent(async request=>{sent.push(request.key);if(++calls===1)throw new TradingApiError(0);if(calls===2)throw error;return parseOrder(response);},()=>`attempt-key-${++keys}`);
    await assert.rejects(sticky.execute(command,snapshot));await assert.rejects(sticky.execute(command,snapshot));
    await sticky.execute(command,snapshot);assert.equal(new Set(sent).size,1);
    assert.doesNotMatch(JSON.stringify(error),/secret-credential/);
  }
  for(const [status,code] of [[500,"ENGINE_RECOVERING"],[409,"INSUFFICIENT_MARGIN"]] as const) {
    await assert.rejects(tradingJson("http://trade.example","account/orders",{},async()=>Response.json({code,outcome:"UNKNOWN",attemptOutcome:"NOT_ACCEPTED"},{status})),value=>value instanceof TradingApiError&&value.attemptOutcome===undefined&&uncertainMutation(value));
  }
});

test("in-flight intent never shares another command/owner result and old confirmation is hidden after identity change",async()=>{
  let finish!:(value:ReturnType<typeof parseOrder>)=>void;let calls=0,keys=0;
  const intent=createTradingIntent(async()=>{calls++;return new Promise(resolve=>{finish=resolve;});},()=>`identity-key-${++keys}`);
  const first=intent.execute(command,snapshot);
  await assert.rejects(intent.execute({...command,quantity:"0.002"},snapshot));
  await assert.rejects(intent.execute(command,{...snapshot,accountId:8,generation:2}));
  assert.equal(calls,1); finish(parseOrder(response)); await first;
  const unknown=createTradingIntent(async()=>{throw new TradingApiError(0);},()=>`identity-key-${++keys}`);
  await assert.rejects(unknown.execute(command,snapshot));
  const retained=unknown.getUnconfirmed(snapshot)!; assert.equal(retained.command.kind,"open");
  if(retained.command.kind==="open")retained.command.quantity="999";
  assert.deepEqual(unknown.getUnconfirmed(snapshot)!.command,command);
  assert.equal(unknown.getUnconfirmed({...snapshot,generation:2}),null);
  await assert.rejects(unknown.execute(command,{...snapshot,accountId:8,generation:2}));
  assert.equal(unknown.getUnconfirmed(snapshot),null);
});
test("authenticated writes keep Bearer private, send decimal strings and never recreate/replay on 401", async () => {
  const store = new Map<string, string>(); let creates = 0; let writes = 0;
  const token = `guest_${"x".repeat(43)}`;
  const session = createGuestSession("http://trade.example", () => ({ getItem: (key) => store.get(key) ?? null, setItem: (key, value) => { store.set(key, value); }, removeItem: (key) => { store.delete(key); } }), async (url, options) => {
    if (String(url).endsWith("accounts/guest")) { creates++; return new Response(JSON.stringify({ accountId: 7, status: "ACTIVE", quoteAsset: "USDT", initialBalance: "10000", accessToken: token, tokenType: "Bearer", expiresAt: "2099-01-01T00:00:00Z" })); }
    writes++; assert.equal(String(url).includes(token), false);
    assert.equal((options?.headers as Record<string, string>).Authorization, `Bearer ${token}`);
    assert.equal((options?.headers as Record<string, string>)["Idempotency-Key"], "order-key-0001");
    assert.equal(JSON.parse(String(options?.body)).quantity, "0.00100000");
    return new Response(JSON.stringify({ detail: token }), { status: 401 });
  });
  await session.createGuest();
  await assert.rejects(session.write(command, session.getSnapshot(), "order-key-0001"), (error: unknown) => error instanceof TradingApiError && !String(error).includes(token));
  assert.equal(creates, 1); assert.equal(writes, 1);
  assert.equal(session.getSnapshot().phase, "anonymous");
  assert.equal(store.get(session.storageKey), undefined);
  await assert.rejects(session.write(command, { ...session.getSnapshot(), generation: 999 }, "order-key-0002")); assert.equal(writes, 1);
});
