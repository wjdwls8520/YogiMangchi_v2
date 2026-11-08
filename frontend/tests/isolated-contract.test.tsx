import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";
import { parsePosition } from "../src/features/trading/api/account";
import { parseLeverage } from "../src/features/trading/api/leverage-contract";
import { isolatedReady } from "../src/features/trading/api/margin";
import { parseQuote, readQuote, readSubmitQuote, type QuoteRequest } from "../src/features/trading/api/quote";
import { createGuestSession, type GuestSession } from "../src/features/trading/api/guest-session";
import { TradingApiError } from "../src/features/trading/api/client";
import { LiquidationPrice } from "../src/features/trading/components/liquidation-price";
import { PositionStopLoss } from "../src/features/trading/components/position-stop-loss";
import { stopLossEstimate, stopLossRoePreset } from "../src/features/trading/api/position-display";
import { MemberProvider } from "../src/features/member/components/member-provider";
import { TradingDataProvider } from "../src/features/trading/components/trading-data-provider";
import { SelectedMarketProvider } from "../src/features/trading/components/selected-market-provider";
import { emptyOrderBook } from "../src/features/trading/market/order-book";
import { TradingEventStatus } from "../src/features/trading/components/trading-event-status";
import { parseTradingEvents } from "../src/features/trading/api/trading-events";
import { OrderHistoryTable, OrderSnapshotDetail, PendingOrderTable, readOrderSnapshot } from "../src/features/trading/components/account-tables";
import { parseOrder } from "../src/features/trading/api/orders";

const time="2026-10-22T00:00:00Z";
const position={id:1,tradingSymbolId:2,side:"LONG",quantity:"1",reservedCloseQuantity:"0",freeCloseQuantity:"1",entryPrice:"100",leverage:100,margin:"1",status:"OPEN",realizedPnl:"0",markPrice:"100",unrealizedPnl:"0",priceStatus:"FRESH",priceEventTime:time,openedAt:time,marginMode:"ISOLATED",openedMarginMode:"ISOLATED",liquidationPrice:"99.000000000000000001",liquidationPriceStatus:"ESTIMATED_DOWNWARD",liquidationPriceAsOf:time};
const request:QuoteRequest={tradingSymbolId:2,type:"MARKET",side:"LONG",quantity:"1"};
const quote={tradingSymbolId:2,type:"MARKET",side:"LONG",leverage:100,quantity:"1.00000000",referencePrice:"100.000000000000000001",notional:"100.000000000000000001",margin:"1.000000000000000001",feeRate:"0.0005",estimatedFee:"0.050000000000000001",totalRequired:"1.050000000000000002",availableBalance:"10000",balancePercentage:null,priceEventTime:time,quotedAt:time};

test("submit quote retries only ENGINE_RECOVERING once, retaining the request and cancellation", async () => {
  const recovery = new TradingApiError(503, undefined, "ENGINE_RECOVERING");
  const riskPending = new TradingApiError(503, undefined, "ACCOUNT_RISK_PENDING", undefined, "NOT_ACCEPTED");
  for (const [first, second, cancel, count] of [
    [recovery, null, false, 2],
    [riskPending, null, false, 2],
    [riskPending, riskPending, false, 2],
    [recovery, recovery, false, 2],
    [recovery, null, true, 1],
    [new TradingApiError(503), null, false, 1],
    [new TradingApiError(401), null, false, 1],
    [new TradingApiError(503, undefined, "ACCOUNT_RISK_PENDING"), null, false, 1],
    [new DOMException("Aborted", "AbortError"), null, false, 1],
    [new TradingApiError(409, undefined, "ENGINE_RECOVERING"), null, false, 1],
  ] as const) {
    const controller = new AbortController();
    const identity = { phase: "ready", accountId: 1, generation: 1 } as const;
    let calls = 0;
    const session: Pick<GuestSession, "read"> = {
      async read(path, snapshot, signal, body) {
        assert.equal(path, "account/orders/quote");
        assert.equal(snapshot, identity);
        assert.equal(signal, controller.signal);
        assert.equal(body, request);
        if (++calls === 1) throw first;
        if (second) throw second;
        return quote;
      },
    };
    const result = readSubmitQuote(session as GuestSession, identity, request, controller.signal);
    const timer = cancel ? setTimeout(() => controller.abort(), 20) : undefined;
    if (cancel) await assert.rejects(result, { name: "AbortError" });
    else if (second || count === 1) await assert.rejects(result, error => error === (second ?? first));
    else assert.equal((await result).quantity, quote.quantity);
    clearTimeout(timer);
    assert.equal(calls, count);
  }
});

test("isolated liquidation contracts preserve server precision and never fabricate an unavailable threshold",()=>{
  assert.equal(parsePosition(position).liquidationPrice,position.liquidationPrice);
  for(const patch of [{liquidationPrice:null},{liquidationPriceAsOf:null},{liquidationPrice:"0"},{liquidationPrice:99},{liquidationPriceStatus:"UNKNOWN"},{liquidationPriceStatus:"PRICE_UNAVAILABLE"}])assert.throws(()=>parsePosition({...position,...patch}));
  for(const status of ["PRICE_UNAVAILABLE","NO_THRESHOLD","UNSUPPORTED_MODEL","ALREADY_AT_RISK","MARGIN_MIGRATION_REQUIRED"]){
    assert.equal(parsePosition({...position,liquidationPrice:null,liquidationPriceStatus:status,liquidationPriceAsOf:null}).liquidationPrice,null);
  }
  const markup=(fresh:boolean)=>renderToStaticMarkup(<LiquidationPrice value={position.liquidationPrice} status="ESTIMATED_DOWNWARD" asOf={time} fresh={fresh}/>);
  assert.ok(markup(true).includes(">99</span>"));
  assert.ok(markup(false).includes("시세 대기"));
  assert.ok(!markup(false).includes(">99."));
});
test("legacy and incomplete margin transitions cannot enable trading even with valid 100x leverage",()=>{
  for(const mode of ["ISOLATED","LEGACY_CROSS"]){
    for(const status of ["COMPLETE","PENDING","REVIEW_REQUIRED"]){
      const value=parseLeverage({tradingSymbolId:2,side:"LONG",leverage:100,maxLeverage:100,marginMode:mode,marginTransitionStatus:status,updatedAt:null},2);
      assert.equal(isolatedReady(value),mode==="ISOLATED"&&status==="COMPLETE");
    }
  }
  assert.equal(isolatedReady(undefined),false);
});
test("quotes match request identity and quantity while retaining server fee and collateral decimals",()=>{
  const parsed=parseQuote(quote,request);
  assert.equal(parsed.totalRequired,quote.totalRequired);
  assert.equal(parsed.estimatedFee,quote.estimatedFee);
  assert.equal(parseQuote({...quote,balancePercentage:100},{...request,quantity:undefined,balancePercentage:100}).quantity,quote.quantity);
  for(const patch of [{tradingSymbolId:3},{side:"SHORT"},{type:"LIMIT"},{quantity:"1.00000001"},{leverage:101},{balancePercentage:50},{estimatedFee:0.05},{quotedAt:"invalid"}])assert.throws(()=>parseQuote({...quote,...patch},request));
});
test("read-only quote POST uses authenticated transport, cancellation and no idempotency key or financial mutation",async()=>{
  const values=new Map<string,string>();let calls=0;
  const session=createGuestSession("http://trade.example",()=>({getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value);},removeItem:key=>{values.delete(key);}}),async(url,options)=>{
    calls++;
    if(calls===1)return Response.json({accountId:1,status:"ACTIVE",quoteAsset:"USDT",initialBalance:"10000",accessToken:`guest_${"a".repeat(43)}`,tokenType:"Bearer",expiresAt:"2099-01-01T00:00:00Z"});
    assert.equal(String(url),"http://trade.example/api/v1/trading/account/orders/quote");
    assert.equal(options?.method,"POST");assert.equal(options?.credentials,"omit");
    const headers=new Headers(options?.headers);
    assert.ok(headers.get("Authorization")?.startsWith("Bearer guest_"));assert.equal(headers.get("Idempotency-Key"),null);
    assert.deepEqual(JSON.parse(String(options?.body)),request);
    return Response.json(quote);
  });
  await session.createGuest();
  assert.equal((await readQuote(session,session.getSnapshot(),request,new AbortController().signal)).estimatedFee,quote.estimatedFee);
  assert.equal(calls,2);
});

test("PositionStopLoss modal displays Entry/Mark/Liq. prices, computes -25% ROE stopPrice and shows Estimated PnL / ROE / Fee preview", () => {
  const slPosition = parsePosition({
    ...position,
    leverage: 10,
    margin: "10",
    markPrice: "100",
    liquidationPrice: "91",
    stopLoss: { positionId: 1, tradingSymbolId: 2, side: "LONG", status: "ACTIVE", stopPrice: "95", version: 1, updatedAt: time, triggeredAt: null, priceEventTime: null, triggerPrice: null, triggerOrderId: null, reason: null },
  });
  const preset25 = stopLossRoePreset(slPosition, 25);
  assert.equal(preset25, "97.5");
  assert.equal(stopLossRoePreset(slPosition, 10), "99");
  assert.equal(stopLossRoePreset(slPosition, 50), "95");
  assert.equal(stopLossRoePreset(slPosition, 75), "92.5");
  assert.equal(stopLossRoePreset({ ...slPosition, side: "SHORT" }, 25), "102.5");

  const estimate = stopLossEstimate(slPosition, preset25, "101.25");
  assert.deepEqual(estimate, {
    grossPnl: "-2.5",
    estimatedRoe: "-25",
    estimatedFee: "0.04875",
    warning: null,
  });
  assert.equal(
    stopLossEstimate(slPosition, "102", "101.25")?.warning,
    "LONG 손절가는 현재 Mark 아래(SHORT는 현재 Mark 위)로 입력해 주세요.",
  );
  assert.equal(
    stopLossEstimate(slPosition, "90.5", "101.25")?.warning,
    "강제청산 예상가보다 먼저 발동되는 가격으로 설정해 주세요.",
  );

  const symbol = { id: 2, symbol: "BTC", displaySymbol: "BTC / USDT", quoteAsset: "USDT", name: "Bitcoin" };
  const liveMark = { decimal: "101.25", value: 101.25, eventTime: Date.now(), expiresAt: Date.now() + 60_000 };
  const client = new QueryClient();
  try {
    const html = renderToStaticMarkup(
      <MemberProvider>
        <TradingDataProvider client={client}>
          <SelectedMarketProvider symbol={symbol} market={{ symbolId: 2, state: "READY", recovery: 0, price: liveMark }} orderBook={emptyOrderBook(2)} positionPrices={{ 2: liveMark }}>
            <PositionStopLoss position={slPosition} symbol="BTC / USDT" initialPrice={preset25} />
          </SelectedMarketProvider>
        </TradingDataProvider>
      </MemberProvider>,
    );
    assert.match(html, /평균 진입가 \(Entry Price\)<\/dt><dd>100<\/dd>/);
    assert.match(html, /현재 Mark Price<\/dt><dd>101\.25<\/dd>/);
    assert.match(html, /예상 강제청산가 \(Liq\. Price\)<\/dt><dd>91<\/dd>/);
    assert.match(html, /유효 범위: 강제청산가 초과 ~ 현재 Mark 미만/);
    for (const label of ["-10%", "-25%", "-50%", "-75%"]) assert.equal(html.includes(`>${label}</button>`), true, label);
    assert.match(html, /예상 실현 손익\(Gross\): -2\.50 USDT \(-25\.00%\) · 예상 수수료\(0\.05%\): 0\.05 USDT/);
  } finally {
    client.clear();
  }
});

test("OrderSnapshotDetail fetches account/orders/{orderId} and renders refreshed snapshot details", async () => {
  const sampleOrder = parseOrder({
    orderId: 31, positionId: 1, tradingSymbolId: 2, type: "LIMIT", action: "OPEN", side: "LONG", status: "PENDING",
    quantity: "0.5", feeRate: "0.0005", reservedFee: "0.025", leverage: 10, requestedLeverage: 10,
    limitPrice: "98", reservedMargin: "4.9", reservedCloseQuantity: "0", createdAt: time, completedAt: null, reason: null, fill: null,
  });
  const refreshedOrder = { ...sampleOrder, status: "FILLED", reservedMargin: "0", reservedFee: "0" };
  const values = new Map<string, string>();
  let orderCalls = 0;
  const session = createGuestSession(
    "http://trade.example",
    () => ({ getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: k => { values.delete(k); } }),
    async url => {
      if (String(url).endsWith("/accounts/guest")) {
        return Response.json({ accountId: 1, status: "ACTIVE", quoteAsset: "USDT", initialBalance: "10000", accessToken: `guest_${"b".repeat(43)}`, tokenType: "Bearer", expiresAt: "2099-01-01T00:00:00Z" });
      }
      orderCalls++;
      assert.equal(String(url), "http://trade.example/api/v1/trading/account/orders/31");
      return Response.json(refreshedOrder);
    },
  );
  await session.createGuest();
  const fetched = await readOrderSnapshot(session, session.getSnapshot(), 31, new AbortController().signal);
  assert.equal(orderCalls, 1);
  assert.equal(fetched.status, "FILLED");

  const symbols = [{ id: 2, symbol: "BTC", displaySymbol: "BTC / USDT", quoteAsset: "USDT", name: "Bitcoin" }];
  const client = new QueryClient();
  try {
    const pendingHtml = renderToStaticMarkup(
      <MemberProvider>
        <TradingDataProvider session={session} client={client}>
          <PendingOrderTable orders={[sampleOrder]} symbols={symbols} />
        </TradingDataProvider>
      </MemberProvider>,
    );
    assert.match(pendingHtml, /단건 상태 재조회/);
    const historyHtml = renderToStaticMarkup(<OrderHistoryTable orders={[sampleOrder]} symbols={symbols} />);
    assert.match(historyHtml, /단건 상태 재조회/);
    const detailHtml = renderToStaticMarkup(<OrderSnapshotDetail order={sampleOrder} symbols={symbols} latest={fetched} />);
    assert.match(detailHtml, /최신 상태: 체결 완료 · 예약 증거금: 0\.00 USDT · 예약 수수료: 0\.00 USDT · 수수료율: 0\.00/);
  } finally {
    client.clear();
  }
});

test("TradingEventStatus opens the 최근 알림 내역 dialog and renders recent events from account/events", async () => {
  const rawEvents = [
    {
      eventId: "101",
      type: "ORDER_FILLED",
      occurredAt: time,
      order: {
        orderId: 41, positionId: 1, tradingSymbolId: 2, type: "LIMIT", action: "OPEN", side: "LONG", status: "FILLED",
        quantity: "0.25", feeRate: "0.0005", reservedFee: "0", leverage: 10, requestedLeverage: 10, limitPrice: "99",
        reservedMargin: "0", reservedCloseQuantity: "0", createdAt: time, completedAt: time, reason: null,
        fill: { fillId: 9, quantity: "0.25", price: "99", priceEventTime: time, executedAt: time, realizedPnl: "0", fee: "0.01", settlementAdjustment: "0", marginMode: "ISOLATED" },
      },
    },
    {
      eventId: "102",
      type: "POSITION_LIQUIDATED",
      occurredAt: time,
      order: {
        orderId: 42, positionId: 1, tradingSymbolId: 2, type: "MARKET", action: "LIQUIDATE", side: "LONG", status: "FILLED",
        quantity: "0.25", feeRate: "0.0005", reservedFee: "0", leverage: 10, requestedLeverage: 10, limitPrice: null,
        reservedMargin: "0", reservedCloseQuantity: "0", createdAt: time, completedAt: time, reason: null,
        fill: { fillId: 10, quantity: "0.25", price: "90", priceEventTime: time, executedAt: time, realizedPnl: "-2.25", fee: "0.01", settlementAdjustment: "0", marginMode: "ISOLATED" },
      },
    },
  ];
  const values = new Map<string, string>();
  let eventCalls = 0;
  const session = createGuestSession(
    "http://trade.example",
    () => ({ getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: k => { values.delete(k); } }),
    async url => {
      if (String(url).endsWith("/accounts/guest")) {
        return Response.json({ accountId: 1, status: "ACTIVE", quoteAsset: "USDT", initialBalance: "10000", accessToken: `guest_${"c".repeat(43)}`, tokenType: "Bearer", expiresAt: "2099-01-01T00:00:00Z" });
      }
      eventCalls++;
      assert.equal(String(url), "http://trade.example/api/v1/trading/account/events?afterId=0&limit=50");
      return Response.json(rawEvents);
    },
  );
  await session.createGuest();
  const parsed = await session.readEvents(session.getSnapshot(), new AbortController().signal, 50);
  assert.equal(eventCalls, 1);
  assert.equal(parsed.length, 2);

  const client = new QueryClient();
  try {
    const html = renderToStaticMarkup(
      <MemberProvider>
        <TradingDataProvider session={session} client={client}>
          <TradingEventStatus initialEvents={parseTradingEvents(rawEvents)} defaultOpen />
        </TradingDataProvider>
      </MemberProvider>,
    );
    assert.match(html, /최근 알림 내역/);
    assert.match(html, /<dialog[^>]*\sopen=""/);
    assert.match(html, /지정가 주문이 체결되었습니다/);
    assert.match(html, /포지션이 강제청산되었습니다/);
    assert.doesNotMatch(html, />새로고침<\/button>/);
    assert.match(html, />닫기<\/button>/);
  } finally {
    client.clear();
  }
});
