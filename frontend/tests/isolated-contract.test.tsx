import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { parsePosition } from "../src/features/trading/api/account";
import { parseLeverage } from "../src/features/trading/api/leverage-contract";
import { isolatedReady } from "../src/features/trading/api/margin";
import { parseQuote, readQuote, type QuoteRequest } from "../src/features/trading/api/quote";
import { createGuestSession } from "../src/features/trading/api/guest-session";
import { LiquidationPrice } from "../src/features/trading/components/liquidation-price";

const time="2026-10-22T00:00:00Z";
const position={id:1,tradingSymbolId:2,side:"LONG",quantity:"1",reservedCloseQuantity:"0",freeCloseQuantity:"1",entryPrice:"100",leverage:100,margin:"1",status:"OPEN",realizedPnl:"0",markPrice:"100",unrealizedPnl:"0",priceStatus:"FRESH",priceEventTime:time,openedAt:time,marginMode:"ISOLATED",openedMarginMode:"ISOLATED",liquidationPrice:"99.000000000000000001",liquidationPriceStatus:"ESTIMATED_DOWNWARD",liquidationPriceAsOf:time};
const request:QuoteRequest={tradingSymbolId:2,type:"MARKET",side:"LONG",quantity:"1"};
const quote={tradingSymbolId:2,type:"MARKET",side:"LONG",leverage:100,quantity:"1.00000000",referencePrice:"100.000000000000000001",notional:"100.000000000000000001",margin:"1.000000000000000001",feeRate:"0.0005",estimatedFee:"0.050000000000000001",totalRequired:"1.050000000000000002",availableBalance:"10000",balancePercentage:null,priceEventTime:time,quotedAt:time};

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
      const value=parseLeverage({tradingSymbolId:2,leverage:100,maxLeverage:100,marginMode:mode,marginTransitionStatus:status,updatedAt:null},2);
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
