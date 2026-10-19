import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { parsePosition } from "../src/features/trading/api/account";
import { closePreflight, closePreset, liquidationUpdates, marketSubscriptionBatches, positionValuation, positionCloseCommand } from "../src/features/trading/api/position-display";
import { sizingUnavailable } from "../src/features/trading/api/order-preflight";
import { mutationRequest, createTradingIntent, mutationMessage } from "../src/features/trading/api/mutation-request";
import { parseOrder } from "../src/features/trading/api/orders";
import { tradingMutationEffects } from "../src/features/trading/api/mutations";
import { tradingKeys } from "../src/features/trading/api/query-keys";
import { TradingApiError } from "../src/features/trading/api/client";
import { CloseOrderFields } from "../src/features/trading/components/close-order-fields";
import { PositionCloseEntry } from "../src/features/trading/components/position-close-entry";
import { OrderHistoryTable, PendingOrderTable, PositionTable } from "../src/features/trading/components/account-tables";
import { TradingDataProvider } from "../src/features/trading/components/trading-data-provider";
import { SelectedMarketProvider } from "../src/features/trading/components/selected-market-provider";
import { emptyOrderBook } from "../src/features/trading/market/order-book";
import type { ReactNode } from "react";

const now=Date.now(), mark={decimal:"110",value:110,eventTime:now,expiresAt:now+5000};
const position=parsePosition({id:1,tradingSymbolId:1,side:"LONG",quantity:"1",reservedCloseQuantity:"0.2",freeCloseQuantity:"0.8",entryPrice:"100",leverage:10,margin:"10",status:"OPEN",realizedPnl:"0",markPrice:"100",unrealizedPnl:"0",priceStatus:"FRESH",priceEventTime:new Date(now).toISOString(),openedAt:new Date(now).toISOString()});
const order=(id=1,action="OPEN",status="FILLED")=>parseOrder({orderId:id,positionId:1,tradingSymbolId:1,type:"LIMIT",action,side:"LONG",status,quantity:"0.2",leverage:10,requestedLeverage:10,limitPrice:"120",reservedMargin:"0",reservedCloseQuantity:status==="PENDING" ? "0.2" : "0",createdAt:new Date(now).toISOString(),completedAt:status==="PENDING" ? null : new Date(now).toISOString(),reason:null,fill:status==="FILLED" ? {fillId:id,quantity:"0.2",price:"121",priceEventTime:new Date(now).toISOString(),executedAt:new Date(now).toISOString(),realizedPnl:"4.2"} : null});
const symbols=[{id:1,symbol:"BTC",displaySymbol:"BTC / USDT",quoteAsset:"USDT",name:"Bitcoin"}];

test("LONG/SHORT Mark, PnL and ROE update independently without mutating server position data",()=>{
  const before=JSON.stringify(position);
  assert.deepEqual(positionValuation(position,mark,now),{mark:"110",pnl:"10",roe:"100"});
  assert.deepEqual(positionValuation({...position,side:"SHORT"},mark,now),{mark:"110",pnl:"-10",roe:"-100"});
  assert.equal(positionValuation({...position,quantity:"0.5",margin:"5"},mark,now).pnl,"5");
  assert.equal(positionValuation(position,{...mark,decimal:"90"},now).pnl,"-10");
  assert.equal(JSON.stringify(position),before);
});
test("PnL retains tiny signed decimals and ROE handles zero margin without floating point",()=>{
  const value=positionValuation({...position,entryPrice:"1",quantity:"0.00000001",margin:"0"},{...mark,decimal:"0.999999999999999999999999999999"},now);
  assert.equal(value.pnl,"-0.00000000000000000000000000000000000001");assert.equal(value.roe,null);
});
test("expired/missing/malformed position marks clear price, PnL and ROE together",()=>{
  for(const value of [null,{...mark,expiresAt:now},{...mark,decimal:"NaN"}]) assert.deepEqual(positionValuation(position,value,now),{mark:null,pnl:null,roe:null});
});
test("multi-symbol batching covers every held identity once, prioritizes selected and respects 32/socket",()=>{
  const batches=marketSubscriptionBatches(1,[1,...Array.from({length:100},(_,i)=>i+1),0,NaN]);
  assert.equal(batches.length,4);assert.equal(batches[0][0],1);assert.ok(batches.every(batch=>batch.length<=32));
  assert.equal(new Set(batches.flat()).size,100);assert.equal(batches.flat().length,100);
  assert.deepEqual(marketSubscriptionBatches(null,[]),[]);
});
for(const percent of [25,50,75,100]) test(`MARKET and LIMIT close ${percent}% use free quantity, never total size or Wallet`,()=>{
  const quantity=closePreset(position.freeCloseQuantity,percent);
  assert.equal(quantity,String(0.8*percent/100));
  assert.equal(closePreflight(position,"MARKET",quantity,"",mark,true,now),null);
  assert.equal(closePreflight(position,"LIMIT",quantity,"120",mark,true,now),null);
  const command={kind:"limitClose" as const,positionId:1,quantity,limitPrice:"120"};
  assert.equal(mutationRequest(command).body?.quantity,quantity);
});
test("close quantity floor is bounded to eight decimals and cannot produce an invalid dust order",()=>{
  assert.equal(closePreset("0.00000003",50),"0.00000001");assert.equal(closePreset("0.00000001",25),"");
  assert.equal(closePreset("0.00000001",100),"0.00000001");assert.equal(closePreset("1",110),"");
});
for(const [side,limit,allowed] of [["LONG","111",true],["LONG","110",false],["LONG","109",false],["SHORT","109",true],["SHORT","110",false],["SHORT","111",false]] as const) test(`${side} CLOSE passive limit ${limit} vs Mark 110`,()=>{
  assert.equal(closePreflight({...position,side},"LIMIT","0.4",limit,mark,true,now)===null,allowed);
});
test("direct close quantity is checked against refreshed reservation and fresh Mark at submit",()=>{
  assert.equal(closePreflight(position,"MARKET","0.8","",mark,true,now),null);
  assert.match(closePreflight({...position,freeCloseQuantity:"0.6"},"MARKET","0.8","",mark,true,now)!,/초과/);
  assert.match(closePreflight({...position,freeCloseQuantity:"0"},"MARKET","0.8","",mark,true,now)!,/가능한 수량/);
  assert.ok(closePreflight(position,"MARKET","0.000000001","",mark,true,now));
  assert.ok(closePreflight(position,"MARKET","0.4","",mark,true,now+5000));
  assert.ok(closePreflight(position,"MARKET","0.4","",mark,false,now));
});
test("LIMIT close keeps the explicit requested price and reservation-sized quantity through uncertain retry",async()=>{
  const command={kind:"limitClose" as const,positionId:1,quantity:"0.4",limitPrice:"120.000000000000000001"};
  const identity={phase:"ready" as const,accountId:1,generation:1};let calls=0;
  const requests:unknown[]=[];
  const intent=createTradingIntent(async request=>{calls++;requests.push(request);if(calls===1)throw new TradingApiError(0);return order();},()=>"close-key-0001");
  await assert.rejects(intent.execute(command,identity));assert.equal(calls,1);
  await assert.rejects(intent.execute({...command,quantity:"0.8"},identity));assert.equal(calls,1);
  await intent.execute(command,identity);assert.deepEqual(requests[0],requests[1]);
  assert.deepEqual(mutationRequest(command).body,{quantity:"0.4",limitPrice:"120.000000000000000001"});
});
test("close backend rejections have controlled feedback and refresh all account data without replay",async()=>{
  const client=new QueryClient(),identity={phase:"ready" as const,accountId:1,generation:1};
  const messages:string[]=[];
  const effects=tradingMutationEffects(client,{getSnapshot:()=>identity},undefined,error=>messages.push(mutationMessage(error)));
  try {for(const code of ["CLOSE_QUANTITY_EXCEEDED","MARKETABLE_LIMIT_NOT_ALLOWED"]) {
    for(const key of [tradingKeys.summary(identity),tradingKeys.pending(identity),tradingKeys.history(identity)])client.setQueryData(key,[]);
    const error=new TradingApiError(409,"Bearer secret",code),request={command:{kind:"limitClose" as const,positionId:1,quantity:"0.4",limitPrice:"120"},session:identity};
    effects.onError(error,request);await effects.onSettled(undefined,error,request);
    for(const key of [tradingKeys.summary(identity),tradingKeys.pending(identity),tradingKeys.history(identity)])assert.equal(client.getQueryState(key)?.isInvalidated,true);
    assert.doesNotMatch(messages.at(-1)!,/secret/);
  }}finally{client.clear();}
});
test("invalid LIMIT price explains zero quantity and valid price supports existing presets",()=>{
  assert.match(sizingUnavailable("LIMIT","",true,"10000")!,/수량은 0/);
  assert.equal(sizingUnavailable("LIMIT","99",true,"10000"),null);
  assert.ok(sizingUnavailable("MARKET","100",false,"10000"));
});
test("liquidation feedback ignores history at mount, detects new confirmed events and does not invent positions",()=>{
  assert.deepEqual(liquidationUpdates(null,[order(1,"LIQUIDATE")]).notices,[]);
  const update=liquidationUpdates(1,[order(3,"LIQUIDATE"),order(2,"CLOSE"),order(1,"LIQUIDATE")]);
  assert.deepEqual(update.notices.map(row=>row.orderId),[3]);assert.equal(update.newest,3);
  assert.deepEqual(liquidationUpdates(3,[order(3,"LIQUIDATE")]).notices,[]);
});
test("shared close fields render MARKET without price, LIMIT with price, and reservation presets",()=>{
  const props={prefix:"close-1",type:"MARKET" as const,quantity:"0.4",limitPrice:"",ratio:50,disabled:false,partialOnly:false,unit:"BTC",onType:()=>{},onQuantity:()=>{},onPrice:()=>{},onRatio:()=>{}};
  const market=renderToStaticMarkup(<CloseOrderFields {...props}/>),limit=renderToStaticMarkup(<CloseOrderFields {...props} type="LIMIT" limitPrice="120"/>);
  assert.doesNotMatch(market,/id="close-1-price"/);assert.match(limit,/id="close-1-price"/);
  for(const percent of [25,50,75,100])assert.match(limit,new RegExp(`>${percent}%<`));
  assert.match(limit,/청산 가능 수량/);assert.match(limit,/step="1"/);
  const partial=renderToStaticMarkup(<CloseOrderFields {...props} partialOnly/>);
  assert.doesNotMatch(partial,/>100%</);assert.match(partial,/max="99"/);
});
function renderTrading(children:ReactNode) {
  let client:QueryClient|undefined;
  function Subject(){client=useQueryClient();return <SelectedMarketProvider symbol={symbols[0]} market={{symbolId:1,state:"READY",recovery:0,price:mark}} orderBook={emptyOrderBook(1)} positionPrices={{1:mark}}>{children}</SelectedMarketProvider>;}
  try{return renderToStaticMarkup(<TradingDataProvider><Subject/></TradingDataProvider>);}finally{client?.clear();}
}
test("positions expose live ROE, reservation/free size and separate partial/full actions",()=>{
  const html=renderTrading(<PositionTable positions={[position]} symbols={symbols}/>);
  for(const text of ["ROE %","청산 예약 수량","청산 가능 수량","부분 청산","전체 청산"])assert.ok(html.includes(text));
  assert.match(html,/role="table"/);assert.match(html,/data-key="roe"/);
});
test("row partial close stays in a closed modal while the Close tab keeps its inline editor",()=>{
  const row=renderTrading(<PositionCloseEntry position={position} symbol="BTC / USDT" layout="row"/>);
  const partial=row.match(/<dialog\b[^>]*class="position-close-dialog position-partial-dialog"[^>]*>[\s\S]*?<\/dialog>/)?.[0];
  assert.ok(partial);
  assert.doesNotMatch(partial.split(">")[0],/\sopen(?:=|\s|$)/);
  assert.match(partial,/aria-modal="true"/);assert.match(partial,/<form/);assert.match(partial,/max="99"/);
  const outside=row.replace(/<dialog\b[\s\S]*?<\/dialog>/g,"");
  assert.doesNotMatch(outside,/<form/);assert.match(outside,/aria-haspopup="dialog"/);
  assert.match(outside,/>부분 청산</);assert.match(outside,/>전체 청산</);
  const panel=renderTrading(<PositionCloseEntry position={position} symbol="BTC / USDT"/>).replace(/<dialog\b[\s\S]*?<\/dialog>/g,"");
  assert.match(panel,/<form/);assert.match(panel,/max="100"/);
});
test("pending and order history distinguish CLOSE, requested/fill prices, realized PnL and liquidation",()=>{
  const pending=renderTrading(<PendingOrderTable orders={[order(1,"CLOSE","PENDING")]} symbols={symbols}/>);
  assert.match(pending,/>CLOSE</);assert.match(pending,/Created \(KST\)/);
  const history=renderToStaticMarkup(<OrderHistoryTable orders={[order(2,"LIQUIDATE")]} symbols={symbols}/>);
  for(const value of ["Requested Price","Fill Price","Realized PnL","Filled (KST)","강제청산","4.2"])assert.ok(history.includes(value));
});
test("partial and full close commands have distinct quantity and reservation guards",()=>{
  const unreserved={...position,reservedCloseQuantity:"0",freeCloseQuantity:"1"};
  assert.equal(positionCloseCommand(unreserved,"MARKET","1","",mark,true,"partial",now).command,null);
  assert.equal(positionCloseCommand(position,"MARKET","1","",mark,true,"full",now).command,null);
  assert.deepEqual(positionCloseCommand(unreserved,"MARKET","1","",mark,true,"full",now).command,{kind:"close",positionId:1,quantity:"1"});
  assert.deepEqual(positionCloseCommand(position,"LIMIT","0.4","120",mark,true,"partial",now).command,{kind:"limitClose",positionId:1,quantity:"0.4",limitPrice:"120"});
  assert.deepEqual(positionCloseCommand(position,"MARKET","0.8","",mark,true,"available",now).command,{kind:"close",positionId:1,quantity:"0.8"});
  for(const scope of ["partial","available","full"] as const) {
    assert.equal(positionCloseCommand(unreserved,"MARKET","bad","",mark,true,scope,now).command,null);
    assert.equal(positionCloseCommand(unreserved,"MARKET","0.4","",null,true,scope,now).command,null);
  }
});
test("close sizing supports 1% steps and never rounds above free quantity",()=>{
  assert.equal(closePreset("0.8",1),"0.008");assert.equal(closePreset("0.8",37),"0.296");assert.equal(closePreset("0.8",99),"0.792");
  for(const percent of [-1,0,100.1,101,NaN])assert.equal(closePreset("1",percent),"");
});
