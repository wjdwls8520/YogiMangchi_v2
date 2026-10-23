import { invalidContract } from "../api/contracts";
import { CandleBook, MAX_CANDLES, type Candle } from "./candles";

export const HISTORY_PREFETCH_BARS = 40;
type HistoryState = { phase: "idle" | "loading" | "error" | "end" | "limit" };
type PageLoader = (before: string, signal: AbortSignal) => Promise<readonly Candle[]>;

// One pager per chart identity. Only latest reconciliation buffers marks; older pages never do.
export class CandleHistoryPager {
  private state: HistoryState = { phase: "idle" };
  private listeners = new Set<() => void>();
  private completed = new Set<string>();
  private request: AbortController | null = null;
  private active = true;
  private previousFrom: number | null = null;
  constructor(private book: CandleBook, private fetchPage: PageLoader) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(phase: HistoryState["phase"]) { this.state = { phase }; this.listeners.forEach((listener) => listener()); }
  activate() { this.active = true; }
  pause() {
    this.active = false;
    const request = this.request; this.request = null;
    request?.abort();
    if (this.state.phase === "loading") this.set("idle");
  }
  resetRange(from: number | null) { this.previousFrom = from; }
  rangeChanged(from: number | null, userNavigation: boolean) {
    const previous = this.previousFrom; this.previousFrom = from;
    // Initial fit, resize and a restored viewport must not drain every page on mount.
    if (userNavigation && from !== null && previous !== null && from < previous && from <= HISTORY_PREFETCH_BARS) void this.load();
  }
  async load() {
    if (!this.active || this.request || this.state.phase === "end" || this.state.phase === "limit") return;
    const oldest = this.book.data[0]?.openTime;
    if (oldest === undefined) return;
    if (this.book.data.length >= MAX_CANDLES) { this.set("limit"); return; }
    const before = new Date(oldest).toISOString();
    if (this.completed.has(before)) return;
    const controller = new AbortController(); this.request = controller; this.set("loading");
    try {
      const page = await this.fetchPage(before, controller.signal);
      if (!this.active || controller.signal.aborted || this.request !== controller) return;
      if (!page.length) { this.completed.add(before); this.set("end"); return; }
      if (this.book.data.length >= MAX_CANDLES) { this.set("limit"); return; }
      if (!this.book.prepend(page)) return invalidContract();
      this.completed.add(before);
      this.set(this.book.data.length >= MAX_CANDLES ? "limit" : "idle");
    } catch {
      if (this.active && !controller.signal.aborted && this.request === controller) this.set("error");
    } finally {
      if (this.request === controller) this.request = null;
    }
  }
}

export type CandleRange = { from: number; to: number };
export function preserveCandleRange(previous: readonly Candle[], next: readonly Candle[], range: CandleRange | null): CandleRange | null {
  if (!range || !previous.length || !next.length) return null;
  const index = Math.max(0, Math.min(previous.length - 1, Math.floor(range.from)));
  const nextIndex = next.findIndex((candle) => candle.openTime === previous[index].openTime);
  if (nextIndex < 0) return null;
  const shift = nextIndex - index;
  return { from: range.from + shift, to: range.to + shift };
}
