import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import { CandleBook, CANDLE_INTERVALS, MAX_CANDLES, candleBucket, candleMillis, parseCandles, type CandleInterval } from "../src/features/trading/market/candles";
import { candleQueryKey } from "../src/features/trading/api/candles";
import { marketCandlesJson } from "../src/features/trading/api/client";
import { marketTransition, waitingMarket } from "../src/features/trading/market/selected-market";

const at = Date.parse("2026-10-15T00:00:00Z");
const row = (interval: CandleInterval = "1m", offset=0) => ({openTime:new Date(at+offset).toISOString(),closeTime:new Date(at+offset+candleMillis(interval)-1).toISOString(),open:"100.000000000000000001",high:"110",low:"90",close:"105"});
const mark = (offset:number, decimal:string) => ({eventTime:at+offset,decimal,value:Number(decimal)});
for (const interval of CANDLE_INTERVALS) test(`${interval} parses UTC buckets and merges the current candle before rolling over`, () => {
  const parsed = parseCandles([row(interval)],interval); const book=new CandleBook(interval); book.reconcile(parsed);
  assert.equal(parsed[0].open,"100.000000000000000001");
  book.update(mark(1000,"120.000000000000000001"));
  book.update(mark(2000,"80")); book.update(mark(3000,"101.000000000000000001"));
  assert.equal(book.data.length,1); assert.deepEqual(book.data[0],{...parsed[0],high:"120.000000000000000001",low:"80",close:"101.000000000000000001"});
  const duration=candleMillis(interval);book.update(mark(duration,"102"));
  assert.equal(book.data.length,2);assert.equal(book.data[1].openTime,at+duration);assert.equal(book.data[1].open,"102");
  assert.equal(candleBucket(at+duration-1,interval),at);
});
test("candle contracts reject duplicates, wrong buckets/ranges, numeric money and malformed times", () => {
  for(const value of [null,{},[{...row(),open:100}],[{...row(),high:"99"}],[{...row(),low:"106"}],
    [{...row(),close:"NaN"}],[{...row(),openTime:"bad"}],[{...row(),closeTime:new Date(at+60000).toISOString()}],
    [row(),row()],[row("1m",60000),row()],[row("1m",1000)]]) assert.throws(()=>parseCandles(value,"1m"));
  assert.deepEqual(parseCandles([],"1m"),[]);
  assert.throws(()=>parseCandles(Array.from({length:501},(_,i)=>row("1m",i*60000)),"1m"));
});
test("late HTTP history replays buffered marks and reconnect replaces provisional closed candles", () => {
  const book=new CandleBook("1m");book.update(mark(1000,"115"));book.update(mark(2000,"116"));book.reconcile(parseCandles([row()],"1m"));
  assert.equal(book.data.length,1);assert.equal(book.data[0].high,"116");assert.equal(book.data[0].close,"116");
  book.update(mark(60000,"117")); book.begin(mark(61000,"118")); book.update(mark(62000,"119"));
  book.reconcile(parseCandles([{...row(),high:"150",low:"70",close:"113"},row("1m",60000)],"1m"));
  assert.equal(book.data[0].high,"150");assert.equal(book.data[0].low,"70");assert.equal(book.data[0].close,"113");
  assert.equal(book.data[1].close,"119");assert.equal(book.data.length,2);
});
test("duplicate, reverse and old bucket marks cannot rewrite history; skipped buckets are not fabricated", () => {
  const book=new CandleBook("1m");book.reconcile(parseCandles([row()],"1m"));book.update(mark(1000,"106"));
  assert.equal(book.update(mark(1000,"999")),null);assert.equal(book.update(mark(500,"999")),null);
  const gap=book.update(mark(180000,"107"));assert.equal(gap?.gap,true);assert.equal(book.data.length,2);
  assert.equal(book.update(mark(179999,"100")),null);
});
test("long running candles and immutable snapshots remain bounded", () => {
  const book=new CandleBook("1m");book.reconcile([]);const original=book.getSnapshot();
  for(let i=0;i<MAX_CANDLES+5;i++)book.update(mark(i*60000,"100"));
  assert.equal(book.data.length,MAX_CANDLES);assert.equal(book.data[0].openTime,at+5*60000);assert.deepEqual(original,[]);
});
test("public Candle transport uses the server contract and forwards cancellation without credentials", async () => {
  const controller=new AbortController();
  await marketCandlesJson("http://server.example",927,"24h",controller.signal,async(url,options)=>{
    assert.equal(String(url),"http://server.example/api/v1/market/candles?tradingSymbolId=927&interval=24h&limit=300");
    assert.equal(options?.credentials,"omit");assert.deepEqual(options?.headers,{});
    controller.abort();assert.equal(options?.signal?.aborted,true);return new Response("[]");
  });
});
test("symbol/timeframe switch cancels old HTTP and late responses cannot overwrite the new query", async () => {
  const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  const oldKey=candleQueryKey("http://server",1,"1m"),nextKey=candleQueryKey("http://server",2,"3m");
  let oldSignal:AbortSignal|undefined,finish!:(value:unknown)=>void;
  const old=client.fetchQuery({queryKey:oldKey,queryFn:({signal})=>{oldSignal=signal;return new Promise(resolve=>{finish=resolve;});}}).catch(()=>null);
  await client.cancelQueries({queryKey:oldKey,exact:true});assert.equal(oldSignal?.aborted,true);
  const expected=parseCandles([row("3m")],"3m");await client.fetchQuery({queryKey:nextKey,queryFn:async()=>expected});
  finish(parseCandles([row()],"1m"));await old;
  assert.deepEqual(client.getQueryData(nextKey),expected);assert.equal(client.getQueryData(oldKey),undefined);
  assert.notDeepEqual(oldKey,candleQueryKey("http://server",1,"3m"));client.clear();
});
test("market recovery revision survives intervening prices and repeated status notifications", () => {
  let market=marketTransition(waitingMarket,1,"WAITING_FOR_FIRST_PRICE");
  market=marketTransition(market,1,"UNAVAILABLE");assert.equal(market.recovery,1);
  market=marketTransition(market,1,"UNAVAILABLE");assert.equal(market.recovery,1);
  market=marketTransition(market,1,"READY");assert.equal(market.recovery,1);
  market=marketTransition(market,1,"RECONNECTING");market=marketTransition(market,1,"READY");assert.equal(market.recovery,2);
  assert.equal(marketTransition(market,2,"CONNECTING").recovery,0);
});
