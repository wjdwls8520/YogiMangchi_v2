export type MarketChartView = "loading" | "ready" | "unavailable" | "empty";
export type PortfolioChartView = "loading" | "data" | "empty" | "unavailable";

export function ChartState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div role="status" aria-live="polite" data-chart-state className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-terminal-panel/95 px-4 text-center">
      <p className="text-trade-body font-medium text-terminal-secondary">{title}</p>
      {detail && <p className="max-w-prose text-trade-meta leading-relaxed text-terminal-muted">{detail}</p>}
    </div>
  );
}
