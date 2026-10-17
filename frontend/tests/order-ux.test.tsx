import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { emptyOrderBook, freshOrderBook, parseOrderBook, selectedOrderBook } from "../src/features/trading/market/order-book";
import { freshMarkPrice } from "../src/features/trading/market/selected-market";
import { OrderBookPanel } from "../src/features/trading/components/order-book-panel";
import { OrderPanel } from "../src/features/trading/components/order-panel";
import { SelectedMarketProvider } from "../src/features/trading/components/selected-market-provider";
import { TradingDataProvider } from "../src/features/trading/components/trading-data-provider";
import { estimatedOrder, ratioQuantity } from "../src/features/trading/api/order-input";
import { balanceIssue, formForSymbol, marketableLimitIssue, orderRejection, preflightOrder, type OpenForm } from "../src/features/trading/api/order-preflight";
import { tradingMutationEffects } from "../src/features/trading/api/mutations";
import { tradingKeys } from "../src/features/trading/api/query-keys";
import { retryTradingQuery, tradingJson, TradingApiError } from "../src/features/trading/api/client";
import { mutationRequest } from "../src/features/trading/api/mutation-request";

const now=Date.parse("2026-10-16T00:00:00Z");
const symbol={id:1,symbol:"BTC",name:"Bitcoin",quoteAsset:"USDT",displaySymbol:"BTC / USDT"};
const input={status:"FRESH",eventTime:new Date(now).toISOString(),receivedAt:new Date(now).toISOString(),
  bids:Array.from({length:20},(_,i)=>({price:String(99-i),quantity:`${i+1}.00000001`})),
  asks:Array.from({length:20},(_,i)=>({price:String(101+i),quantity:`${i+2}.00000002`}))};
const initial:OpenForm={symbolId:1,type:"MARKET",side:"LONG",quantity:"1",limitPrice:"",leverage:10,ratio:0};

test("order book parser preserves decimal strings and validates complete ordered uncrossed top-20 snapshots", () => {
  const book=parseOrderBook(input,1,now);assert.equal(book.status,"FRESH");assert.equal(book.bids[0].quantity,"1.00000001");
  for(const overrides of [{bids:[]},{asks:Array(21).fill(input.asks[0])},{bids:[{price:"0",quantity:"1"}]},
    {bids:[{price:"99",quantity:1}]},{asks:[input.asks[1],input.asks[0]]},{bids:[{price:"101",quantity:"1"}]},
    {eventTime:"bad"},{receivedAt:new Date(now-3000).toISOString()},{eventTime:new Date(now-3001).toISOString()},
    {eventTime:new Date(now+10001).toISOString()},{receivedAt:new Date(now+1001).toISOString()}]) {
    assert.equal(parseOrderBook({...input,...overrides},1,now).status,"UNAVAILABLE");
  }
  assert.deepEqual(selectedOrderBook(book,2),emptyOrderBook(2));
  assert.deepEqual(selectedOrderBook(book,null).bids,[]);
  assert.equal(freshOrderBook({...book,expiresAt:now+1},now).status,"FRESH");assert.deepEqual(freshOrderBook({...book,expiresAt:now},now).asks,[]);
});
test("book renders ten asks above Mark, ten bids below, and no levels for another/stale symbol", () => {
  const book=parseOrderBook(input,1,now), props={symbol,book,mark:"100"};
  const html=renderToStaticMarkup(createElement(OrderBookPanel,props));
  assert.equal((html.match(/data-book-side="ask"/g)??[]).length,10);assert.equal((html.match(/data-book-side="bid"/g)??[]).length,10);
  assert.ok(html.indexOf('>110<')<html.indexOf('>101<'));
  assert.ok(html.indexOf('>101<')<html.indexOf('class="order-book-mark"'));
  assert.ok(html.indexOf('class="order-book-mark"')<html.indexOf('>99<'));
  assert.doesNotMatch(html,/<button|role="button"|tabindex|data-price=/);
  assert.match(html,/Binance 참고 호가/);assert.match(html,/체결 가능 수량이 아니며 주문과 연결되지 않습니다/);
  for(const other of [emptyOrderBook(1,"STALE"),{...book,symbolId:2}]) assert.doesNotMatch(renderToStaticMarkup(createElement(OrderBookPanel,{...props,book:other})),/data-book-side=/);
});
test("public order panel replaces authenticated inputs with a Guest CTA", () => {
  const market={symbolId:1,state:"READY" as const,recovery:0,price:{eventTime:now,decimal:"100",value:100}};
  let client:QueryClient|undefined;
  function Subject() { client=useQueryClient();return <SelectedMarketProvider symbol={symbol} market={market} orderBook={emptyOrderBook(1)}><OrderPanel /></SelectedMarketProvider>; }
  try {
    const html=renderToStaticMarkup(<TradingDataProvider><Subject /></TradingDataProvider>);
    assert.doesNotMatch(html,/id="order-quantity"/);assert.doesNotMatch(html,/id="limit-price"/);
    assert.match(html,/게스트로 모의투자 시작/);assert.doesNotMatch(html,/Order Book/);
  } finally { client?.clear(); }
});
test("symbol changes reset quantity, limit price and quick preset", () => {
  const next={...initial,type:"LIMIT" as const,limitPrice:"99.000000000000000001",quantity:"0.125",ratio:100};
  const reset=formForSymbol(next,2);assert.equal(reset.quantity,"");assert.equal(reset.limitPrice,"");assert.equal(reset.ratio,0);
  assert.equal(formForSymbol(reset,1).quantity,"");
});
test("MARKET presets use the current Mark once; higher/lower prices do not rescale the recorded quantity", () => {
  const quantity=ratioQuantity("10000","80000",10,100);assert.equal(quantity,"1.25");
  const form={...initial,quantity,ratio:100};
  assert.equal(preflightOrder(form,"LONG",true,"96000","10000")?.kind,"balance");
  assert.equal(preflightOrder(form,"LONG",true,"64000","10000"),null);assert.equal(form.quantity,"1.25");assert.equal(form.ratio,100);
  assert.equal(mutationRequest({kind:"open",...form,tradingSymbolId:1}).body?.quantity,"1.25");
});
test("LIMIT all four presets size from limitPrice and keep fixed margin as Mark rises", () => {
  for(const percent of [25,50,75,100]) {
    const quantity=ratioQuantity("10000","80000",10,percent);assert.equal(quantity,String(1.25*percent/100));
    const form={...initial,type:"LIMIT" as const,limitPrice:"80000",quantity,ratio:percent};
    assert.equal(preflightOrder(form,"LONG",true,"90000","10000"),null);
    assert.equal(preflightOrder(form,"LONG",true,"100000","10000"),null);
    assert.equal(estimatedOrder(quantity,form.limitPrice,10)?.margin,String(10000*percent/100));
  }
});
test("LIMIT crossing after a market fall reports relation before any balance warning", () => {
  const form={...initial,type:"LIMIT" as const,limitPrice:"81000",quantity:"1"};
  assert.equal(preflightOrder(form,"LONG",true,"82000","10000"),null);
  assert.equal(preflightOrder(form,"LONG",true,"70000","0")?.kind,"marketable");
  assert.equal(preflightOrder(form,"LONG",true,"82000","1")?.message,balanceIssue("LIMIT").message);
});
for(const [side,limit,allowed] of [["LONG","99",true],["LONG","100",false],["LONG","101",false],
  ["SHORT","101",true],["SHORT","100",false],["SHORT","99",false]] as const) test(`${side} LIMIT ${limit} vs Mark 100 ${allowed?"passes":"is blocked"}`,()=>{
  assert.equal(marketableLimitIssue(side,limit,"100")===null,allowed);
  assert.equal(preflightOrder({...initial,type:"LIMIT",limitPrice:limit},side,true,"100","1000")===null,allowed);
});
test("preflight uses reservation-adjusted available balance and current edited quantity/leverage/limit", () => {
  const form={...initial,type:"LIMIT" as const,limitPrice:"99",quantity:"10",leverage:1};
  assert.equal(preflightOrder(form,"LONG",true,"100","989")?.kind,"balance");
  assert.equal(preflightOrder({...form,leverage:2},"LONG",true,"100","989"),null);
  assert.equal(preflightOrder(form,"LONG",true,"100",null)?.kind,"unavailable");
  for(const value of [{...form,quantity:"0"},{...form,leverage:21},{...form,limitPrice:"NaN"}]) assert.equal(preflightOrder(value,"LONG",true,"100","1000")?.kind,"input");
  assert.equal(preflightOrder(form,"LONG",false,"100","1000")?.kind,"unavailable");
});
test("precision is retained for 30-decimal Mark sizing, passive comparison and CEILING margin at 18 decimals",()=>{
  assert.equal(estimatedOrder("0.00000001","0.000000000000000001",20)?.margin,"0.000000000000000001");
  assert.equal(preflightOrder({...initial,quantity:"0.00000001",leverage:20},"LONG",true,"0.000000000000000001","0")?.kind,"balance");
  assert.equal(estimatedOrder("1","100.000000000000000000000000000001",1)?.margin,"100.000000000000000001");
  assert.equal(ratioQuantity("1","0.000000010000000000000000000001",1,100),"99999999.99999999");
  assert.equal(marketableLimitIssue("LONG","100.000000000000000001","100.000000000000000002"),null);
});
test("Mark freshness is checked at the click even if a background tab's expiry timer has not run",()=>{
  const market={symbolId:1,state:"READY" as const,recovery:0,price:{eventTime:now,decimal:"100",value:100,expiresAt:now+5000}};
  assert.equal(freshMarkPrice(market,now)?.decimal,"100");assert.equal(freshMarkPrice(market,now+5000),null);
});
test("backend margin/marketable rejections report controlled warnings and invalidate account queries",async()=>{
  const client=new QueryClient(),snapshot={phase:"ready" as const,accountId:7,generation:1};
  const alerts:string[]=[];
  const effects=tradingMutationEffects(client,{getSnapshot:()=>snapshot},issue=>alerts.push(issue.message));
  for(const code of ["INSUFFICIENT_MARGIN","MARKETABLE_LIMIT_NOT_ALLOWED"]) {
    const command={kind:"open" as const,type:"LIMIT" as const,tradingSymbolId:1,side:"LONG" as const,quantity:"1",leverage:10,limitPrice:"99"};
    for(const key of [tradingKeys.summary(snapshot),tradingKeys.pending(snapshot),tradingKeys.history(snapshot),["market","http://127.0.0.1:8081","tickers"]]) client.setQueryData(key,[]);
    const error=new TradingApiError(409,"do not display server details",code);
    effects.onError(error,{command,session:snapshot});await effects.onSettled(undefined,error,{command,session:snapshot});
    assert.equal(alerts.at(-1),orderRejection(code,command)?.message);
    for(const key of [tradingKeys.summary(snapshot),tradingKeys.pending(snapshot),tradingKeys.history(snapshot)]) assert.equal(client.getQueryState(key)?.isInvalidated,true);
    assert.equal(client.getQueryState(["market","http://127.0.0.1:8081","tickers"])?.isInvalidated,code==="MARKETABLE_LIMIT_NOT_ALLOWED");
  }
  const old={...snapshot,generation:0};effects.onError(new TradingApiError(409,undefined,"INSUFFICIENT_MARGIN"),{command:{kind:"cancel",orderId:1},session:old});assert.equal(alerts.length,2);client.clear();
});
test("new server error code cannot leak credentials or enable automatic mutation/query replay",async()=>{
  const secret="Bearer guest-credential-secret";
  await assert.rejects(tradingJson("http://server","account/orders",{method:"POST"},async()=>new Response(JSON.stringify({code:"MARKETABLE_LIMIT_NOT_ALLOWED",detail:secret,message:secret}),{status:409})),(error:unknown)=>{
    assert.ok(error instanceof TradingApiError);assert.equal(error.code,"MARKETABLE_LIMIT_NOT_ALLOWED");assert.equal(retryTradingQuery(0,error),false);
    assert.equal(JSON.stringify(error).includes(secret),false);assert.equal(String(error).includes(secret),false);return true;
  });
});
