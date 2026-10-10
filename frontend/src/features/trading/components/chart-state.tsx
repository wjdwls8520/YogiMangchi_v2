export type MarketChartView = "loading" | "ready" | "unavailable" | "empty";
export type PortfolioChartView = "loading" | "data" | "empty" | "unavailable";

export function ChartState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div role="status" aria-live="polite" data-chart-state>
      <p>{title}</p>
      {detail && <p>{detail}</p>}
    </div>
  );
}
