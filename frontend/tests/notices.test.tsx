import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createNoticeStore, NOTICE_LIFETIME, orderFailureNotice, orderNotice } from "../src/features/trading/api/notices";
import { TradingNoticeList } from "../src/features/trading/components/trading-notices";
import { TradingApiError } from "../src/features/trading/api/client";
import type { TradingOrder } from "../src/features/trading/api/orders";

test("notices stack in arrival order and expire individually after 1500ms, with manual dismissal and cleanup",()=>{
  const timers: { callback:()=>void; delay:number; canceled:boolean }[]=[];
  const store=createNoticeStore((callback,delay)=>{const timer={callback,delay,canceled:false};timers.push(timer);return()=>{timer.canceled=true;};});
  const one=store.push({kind:"success",title:"first",message:"done"},"account-1");
  const two=store.push({kind:"error",title:"second",message:"failed"},"account-1");
  assert.equal(NOTICE_LIFETIME,1500);assert.deepEqual(timers.map(timer=>timer.delay),[1500]);
  assert.deepEqual(store.getSnapshot().map(notice=>notice.id),[one,two]);
  timers[0].callback();assert.deepEqual(store.getSnapshot().map(notice=>notice.id),[two]);
  store.dismiss(two!);assert.deepEqual(store.getSnapshot(),[]);assert.equal(timers.length,1);
  store.push({kind:"warning",title:"third",message:"unknown"},"account-2");
  store.clear();assert.deepEqual(store.getSnapshot(),[]);assert.equal(timers.length,1);
});

test("accepted LIMIT is not described as filled, and uncertain results are never described as failed",()=>{
  const command={kind:"open" as const,tradingSymbolId:1,side:"LONG" as const,type:"LIMIT" as const,quantity:"0.001",leverage:100,limitPrice:"60000"};
  const order={orderId:1,status:"PENDING",side:"LONG",type:"LIMIT",quantity:"0.001"} as TradingOrder;
  assert.match(orderNotice(order,command).title,/접수/);assert.match(orderNotice(order,command).message,/체결 대기/);
  assert.match(orderNotice({...order,status:"FILLED"},command).title,/완료/);
  assert.equal(orderNotice({...order,status:"REJECTED"},command).kind,"error");
  assert.match(orderNotice({...order,status:"CANCELED"},{kind:"cancel",orderId:1}).title,/취소/);
  for(const status of [0,422,503])assert.equal(orderFailureNotice(new TradingApiError(status)).kind,"warning");
  const failure=orderFailureNotice(new TradingApiError(409,undefined,"INSUFFICIENT_MARGIN"));
  assert.equal(failure.kind,"error");assert.match(failure.message,/증거금/);
});

test("toast markup has accessible status/error feedback and an individually labeled close button",()=>{
  const html=renderToStaticMarkup(<TradingNoticeList notices={[{id:1,kind:"success",title:"주문 완료",message:"Long 시장가"},{id:2,kind:"error",title:"주문 실패",message:"잔액 부족"}]} dismiss={()=>{}}/>);
  assert.match(html,/role="status"/);assert.match(html,/role="alert"/);
  assert.match(html,/주문 완료 알림 닫기/);assert.match(html,/주문 실패 알림 닫기/);
});


test("REST and WS results deduplicate by identity/order/status even after dismissal", () => {
  const store = createNoticeStore(() => () => {});
  const result = { kind: "error" as const, title: "거절", message: "사유", resultKey: "7:REJECTED" };
  const first = store.push(result, "guest-1");
  assert.equal(store.push(result, "guest-1"), null);
  store.dismiss(first!);
  assert.equal(store.push(result, "guest-1"), null);
  assert.notEqual(store.push({...result,resultKey:"7:FILLED"}, "guest-1"),null);
  store.clear();
  assert.notEqual(store.push(result, "member-1"),null);
});
