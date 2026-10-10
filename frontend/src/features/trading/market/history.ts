export const MAX_PRICE_POINTS = 1800;
const RETAIN_AFTER_PRUNE = 1500;

export type PricePoint = { time: number; value: number };

// Both this buffer and the chart series are bounded. Prune in batches so normal
// ticks use series.update(), rather than replacing the entire series each second.
export class PriceHistory {
  private points: PricePoint[] = [];
  private lastEventTime = -Infinity;

  append(eventTime: number, value: number) {
    if (!Number.isFinite(eventTime) || !Number.isFinite(value) || value <= 0 || eventTime <= this.lastEventTime) return null;
    this.lastEventTime = eventTime;
    const point = { time: Math.floor(eventTime / 1000), value };
    if (this.points.at(-1)?.time === point.time) this.points[this.points.length - 1] = point;
    else this.points.push(point);
    const pruned = this.points.length > MAX_PRICE_POINTS;
    if (pruned) this.points = this.points.slice(-RETAIN_AFTER_PRUNE);
    return { point, pruned, points: this.points };
  }
}
