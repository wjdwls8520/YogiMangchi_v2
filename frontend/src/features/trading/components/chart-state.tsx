export type MarketChartView = "loading" | "ready" | "unavailable" | "empty";
export type PortfolioChartView = "loading" | "data" | "empty" | "unavailable";

export function ChartState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div role="status" aria-live="polite" data-chart-state className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-white/90 px-4 text-center">
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {detail && <p className="max-w-prose text-xs leading-relaxed text-slate-500">{detail}</p>}
    </div>
  );
}
