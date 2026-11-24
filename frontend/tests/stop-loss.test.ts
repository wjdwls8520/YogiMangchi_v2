import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStopLoss, latestStopLoss, stopLossRequest } from "../src/features/trading/api/stop-loss-contract";
import { parseTradingEvent, tradingEventNotice } from "../src/features/trading/api/trading-events";
import { createGuestSession } from "../src/features/trading/api/guest-session";
import { TradingApiError } from "../src/features/trading/api/client";

const at="2026-10-30T00:00:00Z";
const state={positionId:17,tradingSymbolId:1,side:"LONG",status:"ACTIVE",stopPrice:"70000.000000000000000001",version:1,updatedAt:at,triggeredAt:null,priceEventTime:null,triggerPrice:null,triggerOrderId:null,reason:null};
test("stop loss snapshots bind position, version and decimal price; changed events have no order",()=>{
  assert.equal(parseStopLoss(state,17).stopPrice,state.stopPrice);
  assert.throws(()=>parseStopLoss(state,18));
  for(const bad of [{version:-1},{version:0.5},{side:"BOTH"},{status:"ACTIVE",stopPrice:null}])assert.throws(()=>parseStopLoss({...state,...bad}));
  const event=parseTradingEvent({eventId:"19",type:"STOP_LOSS_CHANGED",occurredAt:at,order:null,stopLoss:state});
  assert.equal(event.order,null);assert.equal(tradingEventNotice(event),null);
  assert.throws(()=>parseTradingEvent({eventId:"19",type:"STOP_LOSS_CHANGED",occurredAt:at,order:{},stopLoss:state}));
});
test("stop loss uses PUT/DELETE with optimistic version and exact price, never close-order payloads",()=>{
  assert.deepEqual(stopLossRequest({positionId:17,expectedVersion:0,stopPrice:state.stopPrice}),{path:"account/positions/17/stop-loss",method:"PUT",body:{stopPrice:state.stopPrice,expectedVersion:0}});
  assert.deepEqual(stopLossRequest({positionId:17,expectedVersion:1}),{path:"account/positions/17/stop-loss?expectedVersion=1",method:"DELETE",body:undefined});
  assert.throws(()=>stopLossRequest({positionId:17,expectedVersion:-1}));
});
test("stop loss session writes preserve keys and body on manual recovery; no automatic retry or anonymous HTTP",async()=>{
  const origin="http://trade.example", epoch=Date.parse(at), stored=JSON.stringify({accountId:1,accessToken:`guest_${"a".repeat(43)}`,expiresAt:new Date(epoch+86400000).toISOString()});
  const calls:{method:string;key:string|null;body:unknown}[]=[];
  const session=createGuestSession(origin,()=>({getItem:()=>stored,setItem:()=>{},removeItem:()=>{}}),async(_url,init)=>{
    calls.push({method:init?.method??"GET",key:new Headers(init?.headers).get("Idempotency-Key"),body:init?.body});
    if(calls.length===1)throw new TypeError("credential must not leak");
    return Response.json(state);
  },()=>epoch);
  await session.restore();const identity=session.getSnapshot(),command={positionId:17,expectedVersion:0,stopPrice:state.stopPrice};
  await assert.rejects(session.writeStopLoss(command,identity,"same-test-key"),TradingApiError);
  assert.equal(calls.length,1);
  await session.writeStopLoss(command,identity,"same-test-key");assert.deepEqual(calls[0],calls[1]);
  let anonymousCalls=0;
  const anonymous=createGuestSession(origin,()=>({getItem:()=>null,setItem:()=>{},removeItem:()=>{}}),async()=>{anonymousCalls++;return Response.json(state);},()=>epoch);
  await anonymous.restore();await assert.rejects(anonymous.writeStopLoss(command,anonymous.getSnapshot(),"test-key"));assert.equal(anonymousCalls,0);
});

test("newest stop loss version survives stale GET, summary and idempotent replay snapshots",()=>{
  const old=parseStopLoss(state),current=parseStopLoss({...state,version:3,stopPrice:"71000"});
  assert.equal(latestStopLoss(old,current),current);
  assert.equal(latestStopLoss(current,old),current);
  assert.equal(latestStopLoss(current,parseStopLoss({...state,positionId:18,version:9})),current);
  assert.throws(()=>parseStopLoss(state,17,2,"LONG"));
  assert.throws(()=>parseStopLoss(state,17,1,"SHORT"));
  assert.throws(()=>parseStopLoss({...state,status:"NONE",version:0}));
  assert.throws(()=>parseStopLoss({...state,status:"TRIGGERED"}));
  assert.equal(parseStopLoss({...state,status:"NONE",stopPrice:null,version:0,updatedAt:null}).status,"NONE");
});