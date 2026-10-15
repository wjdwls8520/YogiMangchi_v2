import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import { CandleBook, MAX_CANDLES, type Candle } from "../src/features/trading/market/candles";
import { CandleHistoryPager, HISTORY_PREFETCH_BARS, preserveCandleRange } from "../src/features/trading/market/candle-history";
import { candleQueryKey } from "../src/features/trading/api/candles";
import { marketCandlesJson, retryTradingQuery, TradingApiError } from "../src/features/trading/api/client";
import { formatMarketPrice } from "../src/features/trading/market/price-format";

const at = Date.parse("2026-10-15T00:00:00Z");
const candle = (i: number): Candle => ({ openTime: at+i*60_000, closeTime: at+(i+1)*60_000-1,
  open: "0.00000123456789", high: "0.00000123456799", low: "0.00000123456780", close: "0.00000123456790" });
const page = (from: number, count=300) => Array.from({length: count}, (_, i) => candle(from+i));
const bookWithLatest = () => { const book = new CandleBook("1m"); book.reconcile(page(300)); return book; };
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("latest stays at 300, before uses the oldest ISO openTime, public pages stay at 300", async () => {
  const book=bookWithLatest(); assert.equal(book.data.length,300);
  const pager=new CandleHistoryPager(book, async (before, signal) => {
    assert.equal(before,new Date(candle(300).openTime).toISOString());
    await marketCandlesJson("http://server",1,"1m",signal,async (url, options) => {
      const query=new URL(String(url)).searchParams;
      assert.equal(query.get("before"),before);assert.equal(query.get("limit"),"300");
      assert.equal(query.has("startTime"),false);assert.equal(query.has("endTime"),false);
      assert.deepEqual(options?.headers,{});return new Response("[]");
    },before);
    return page(0);
  });
  await pager.load();assert.equal(book.data.length,600);
});

test("leftward movement prefetches at 40 bars, initial fit/rightward movement do not", async () => {
  let calls=0;const pager=new CandleHistoryPager(bookWithLatest(),async()=>{calls++;return page(0);});
  pager.rangeChanged(100,false);pager.rangeChanged(0,false);await settle();assert.equal(calls,0);
  pager.resetRange(80);pager.rangeChanged(41,true);await settle();assert.equal(calls,0);
  pager.rangeChanged(HISTORY_PREFETCH_BARS,true);await settle();assert.equal(calls,1);
  pager.resetRange(0);pager.rangeChanged(10,true);await settle();assert.equal(calls,1);
});

test("prepend deduplicates boundaries, keeps ascending order, raw decimals and live OHLC", () => {
  const book=bookWithLatest();
  const decimal="0.000001234568001234";
  book.update({eventTime:candle(599).openTime+1000,decimal,value:Number(decimal)});
  const live=book.data.at(-1);
  assert.equal(book.prepend([...page(0),candle(299),{...candle(300),close:"999"},candle(599)]),300);
  assert.equal(book.data.length,600);assert.equal(new Set(book.data.map(c=>c.openTime)).size,600);
  assert.deepEqual(book.data.map(c=>c.openTime),page(0,600).map(c=>c.openTime));
  assert.equal(book.data.at(-1),live);assert.equal(book.data[0].open,"0.00000123456789");
  assert.equal(formatMarketPrice(book.data[0].open,"0.00000000000001"),"0.00000123456789");
});

test("prepend preserves fractional viewport and the range at response time after further dragging", () => {
  const previous=page(300),next=page(0,600);
  assert.deepEqual(preserveCandleRange(previous,next,{from:25.5,to:125.5}),{from:325.5,to:425.5});
  const duringRequest={from:-15.25,to:84.75};
  const restored=preserveCandleRange(previous,next,duringRequest)!;
  assert.equal(restored.from-duringRequest.from,300);assert.equal(restored.to-restored.from,100);
  assert.deepEqual(preserveCandleRange(next,next.slice(1),{from:350,to:450}),{from:349,to:449});
  assert.equal(preserveCandleRange([],next,null),null);
});

test("only one older page is in flight; repeated events cannot duplicate a cursor", async () => {
  const book=bookWithLatest();let calls=0,finish!:(page: Candle[])=>void;
  const cursors:string[]=[];
  const pager=new CandleHistoryPager(book,async(before)=>{calls++;cursors.push(before);return new Promise(resolve=>{finish=resolve;});});
  const first=pager.load();await pager.load();pager.resetRange(10);pager.rangeChanged(9,true);await settle();
  assert.equal(calls,1);finish(page(0));await first;
  const second=pager.load();assert.equal(calls,2);assert.notEqual(cursors[0],cursors[1]);
  finish([]);await second;await pager.load();assert.equal(calls,2);
});

test("empty page ends pagination until the chart identity changes", async () => {
  const book=bookWithLatest();let calls=0;
  const pager=new CandleHistoryPager(book,async()=>{calls++;return [];});
  await pager.load();assert.equal(pager.getSnapshot().phase,"end");
  await pager.load();pager.resetRange(20);pager.rangeChanged(-50,true);await settle();assert.equal(calls,1);
  const next=new CandleHistoryPager(bookWithLatest(),async()=>{calls++;return [];});
  await next.load();assert.equal(calls,2);
});

for (const change of ["symbol","timeframe"]) test(`${change} switch aborts and ignores even a cancellation-resistant stale page`, async () => {
  const oldBook=bookWithLatest(),nextBook=change==="symbol"?bookWithLatest():new CandleBook("4h");
  const original=nextBook.data;let finish!:(page:Candle[])=>void,signal:AbortSignal|undefined;
  const old=new CandleHistoryPager(oldBook,async(_,requestSignal)=>{signal=requestSignal;return new Promise(resolve=>{finish=resolve;});});
  const pending=old.load();old.pause();assert.equal(signal?.aborted,true);
  finish(page(0));await pending;assert.equal(oldBook.data.length,300);assert.equal(nextBook.data,original);
});

test("all query/cache dimensions include origin, symbol, interval and cursor", () => {
  const base=candleQueryKey("http://one",1,"1m","2026-10-15T00:00:00Z");
  for(const other of [candleQueryKey("http://two",1,"1m",base[5]),candleQueryKey("http://one",2,"1m",base[5]),
    candleQueryKey("http://one",1,"4h",base[5]),candleQueryKey("http://one",1,"1m"),candleQueryKey("http://one",1,"1m","2026-10-14T00:00:00Z")]) assert.notDeepEqual(base,other);
});

test("WS keeps updating during older loading and the late page cannot overwrite the current candle", async () => {
  const book=bookWithLatest();let finish!:(page:Candle[])=>void;
  const pager=new CandleHistoryPager(book,()=>new Promise(resolve=>{finish=resolve;}));
  const pending=pager.load();assert.equal(pager.getSnapshot().phase,"loading");
  for(let i=1;i<=3;i++) book.update({eventTime:candle(599).openTime+i*1000,decimal:`0.0000012345680${i}`,value:0.000001234568});
  assert.equal(book.data.at(-1)?.close,"0.00000123456803");
  finish([...page(0),candle(599)]);await pending;assert.equal(book.data.at(-1)?.close,"0.00000123456803");
  assert.equal(book.data.length,600);
});

test("latest recovery reconciles only the tail and retains explored history and buffered current marks", () => {
  const book=bookWithLatest();book.prepend(page(0));
  const eventTime=candle(599).openTime+1000;
  book.begin({eventTime,decimal:"0.000001234569",value:0.000001234569});
  book.update({eventTime:eventTime+1000,decimal:"0.000001234570",value:0.000001234570});
  book.reconcile(page(300));assert.equal(book.data.length,600);assert.equal(book.data[0].openTime,at);
  assert.equal(book.data.at(-1)?.close,"0.000001234570");
  assert.equal(new Set(book.data.map(c=>c.openTime)).size,600);
});

test("historical failure retains a working book, bounds GET retries and allows an explicit retry", async () => {
  const client=new QueryClient({defaultOptions:{queries:{retry:retryTradingQuery,retryDelay:0,gcTime:0}}});
  const book=bookWithLatest();let calls=0,fail=true;
  const pager=new CandleHistoryPager(book,(before)=>client.fetchQuery({queryKey:candleQueryKey("http://server",1,"1m",before),queryFn:async()=>{
    calls++;if(fail)throw new TradingApiError(503);return page(0);
  }}));
  await pager.load();assert.equal(calls,3);assert.equal(pager.getSnapshot().phase,"error");assert.equal(book.data.length,300);
  book.update({eventTime:candle(599).openTime+1000,decimal:"0.000001234569",value:0.000001234569});
  assert.equal(book.data.at(-1)?.close,"0.000001234569");await settle();assert.equal(calls,3);
  fail=false;await pager.load();assert.equal(book.data.length,600);assert.equal(pager.getSnapshot().phase,"idle");client.clear();
});

test("nonprogress pages are recoverable errors; they do not cause a fetch loop", async () => {
  const book=bookWithLatest();let calls=0;const pager=new CandleHistoryPager(book,async()=>{calls++;return page(300);});
  await pager.load();assert.equal(pager.getSnapshot().phase,"error");assert.equal(book.data.length,300);
  await settle();assert.equal(calls,1);
});

test("history cap retains the newly prepended older bars, never trimming them immediately", async () => {
  const book=bookWithLatest();book.prepend(page(300-(MAX_CANDLES-301),MAX_CANDLES-301));
  let calls=0;const pager=new CandleHistoryPager(book,async()=>{calls++;return page(-MAX_CANDLES,300);});
  await pager.load();assert.equal(book.data.length,MAX_CANDLES);assert.equal(book.data[0].openTime,candle(-MAX_CANDLES+299).openTime);
  assert.equal(pager.getSnapshot().phase,"limit");await pager.load();assert.equal(calls,1);
});

test("failed latest reconciliation resumes buffered live marks without erasing older candles", () => {
  const book=bookWithLatest();book.prepend(page(0));book.begin();
  book.update({eventTime:candle(599).openTime+1000,decimal:"0.000001234569",value:0.000001234569});
  book.resume();assert.equal(book.data.length,600);assert.equal(book.data.at(-1)?.close,"0.000001234569");
});
