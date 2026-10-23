import { instant, invalidContract, list, record } from "../api/contracts";
import { comparePrices } from "./price-format";
import type { MarketPrice } from "./stream";

export const CANDLE_INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "4h", "12h", "24h"] as const;
export type CandleInterval = typeof CANDLE_INTERVALS[number];
const minutes: Record<CandleInterval, number> = { "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240, "12h": 720, "24h": 1440 };
export const candleMillis = (interval: CandleInterval) => minutes[interval] * 60_000;
export const candleBucket = (time: number, interval: CandleInterval) => Math.floor(time / candleMillis(interval)) * candleMillis(interval);
export type Candle = { openTime: number; closeTime: number; open: string; high: string; low: string; close: string };
export const MAX_CANDLES = 10_000;
const MAX_PAGE_CANDLES = 500;
function price(value: unknown) {
  if (typeof value !== "string" || value.length > 120 || !/^\d+(\.\d+)?$/.test(value)
    || !Number.isFinite(Number(value)) || Number(value) <= 0) return invalidContract();
  return value;
}
export function parseCandles(value: unknown, interval: CandleInterval): Candle[] {
  let previous = -Infinity;
  const candles = list(value, (value) => {
    const row = record(value);
    const openTime = Date.parse(instant(row.openTime)), closeTime = Date.parse(instant(row.closeTime));
    const open = price(row.open), high = price(row.high), low = price(row.low), close = price(row.close);
    if (openTime < 0 || openTime <= previous || candleBucket(openTime, interval) !== openTime
      || closeTime !== openTime + candleMillis(interval) - 1 || comparePrices(high, open) < 0 || comparePrices(high, close) < 0
      || comparePrices(low, open) > 0 || comparePrices(low, close) > 0 || comparePrices(high, low) < 0) return invalidContract();
    previous = openTime;
    return { openTime, closeTime, open, high, low, close };
  });
  return candles.length <= MAX_PAGE_CANDLES ? candles : invalidContract();
}

// Each instance belongs to exactly one symbol/interval. Latest reconciliation retains explored history.
export class CandleBook {
  private candles: Candle[] = [];
  private lastEvent = -Infinity;
  private pending: MarketPrice[] = [];
  private loaded = false;
  private syncing = true;
  private listeners = new Set<() => void>();
  historyVersion = 0;
  constructor(readonly interval: CandleInterval) { }
  get data(): readonly Candle[] { return this.candles; }
  getSnapshot = () => this.data;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish() { this.listeners.forEach((listener) => listener()); }
  begin(seed: MarketPrice | null = null) { this.syncing = true; this.pending = seed ? [seed] : []; }
  reconcile(history: readonly Candle[]) {
    if (history.length) this.candles = [
      ...this.candles.filter((candle) => candle.openTime < history[0].openTime),
      ...history.map((candle) => ({ ...candle })),
      ...this.candles.filter((candle) => candle.openTime > history[history.length - 1].openTime),
    ].slice(-MAX_CANDLES);
    this.resume();
    return this.data;
  }
  resume() {
    this.loaded = true; this.syncing = false; this.lastEvent = -Infinity;
    const pending = this.pending; this.pending = [];
    pending.forEach((mark) => this.apply(mark));
    this.historyVersion++;
    this.publish();
  }
  prepend(history: readonly Candle[]) {
    const oldest = this.candles[0]?.openTime;
    if (oldest === undefined) return 0;
    // Existing bars win at a page boundary; an older response never touches the live candle.
    const unique = new Map(history.filter((candle) => candle.openTime < oldest).map((candle) => [candle.openTime, candle]));
    const older = [...unique.values()].sort((a, b) => a.openTime - b.openTime)
      .slice(-Math.max(0, MAX_CANDLES - this.candles.length));
    if (this.candles.length >= MAX_CANDLES || !older.length) return 0;
    this.candles = [...older, ...this.candles];
    this.historyVersion++;
    this.publish();
    return older.length;
  }
  update(mark: MarketPrice) {
    if (!this.loaded || this.syncing) {
      this.pending.push(mark);
      if (this.pending.length > 600) this.pending.shift();
      return null;
    }
    const update = this.apply(mark);
    if (update) this.publish();
    return update;
  }
  private apply(mark: MarketPrice) {
    if (!Number.isFinite(mark.eventTime) || mark.eventTime < 0 || mark.eventTime <= this.lastEvent || !/^\d+(\.\d+)?$/.test(mark.decimal)
      || mark.decimal.length > 120 || comparePrices(mark.decimal, "0") <= 0) return null;
    const bucket = candleBucket(mark.eventTime, this.interval), last = this.candles.at(-1);
    if (last && bucket < last.openTime) return null;
    this.lastEvent = mark.eventTime;
    const appended = !last || bucket > last.openTime;
    const candle: Candle = appended ? { openTime: bucket, closeTime: bucket + candleMillis(this.interval) - 1,
      open: mark.decimal, high: mark.decimal, low: mark.decimal, close: mark.decimal }
      : { ...last, high: comparePrices(mark.decimal, last.high) > 0 ? mark.decimal : last.high,
        low: comparePrices(mark.decimal, last.low) < 0 ? mark.decimal : last.low, close: mark.decimal };
    this.candles = appended ? [...this.candles, candle] : [...this.candles.slice(0, -1), candle];
    const pruned = this.candles.length > MAX_CANDLES;
    if (pruned) this.candles = this.candles.slice(-MAX_CANDLES);
    return { candle, appended, pruned, gap: !!last && bucket > last.openTime + candleMillis(this.interval) };
  }
}
