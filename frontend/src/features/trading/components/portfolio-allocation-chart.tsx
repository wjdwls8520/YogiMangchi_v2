"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatMargin, portfolioAllocation, type PortfolioPosition } from "../portfolio/allocation";
import { ChartState, type PortfolioChartView } from "./chart-state";

export function PortfolioAllocationChart({ positions, view: requestedView }: { positions: readonly PortfolioPosition[]; view?: PortfolioChartView }) {
  const allocation = useMemo(() => portfolioAllocation(positions), [positions]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const instance = useRef<import("chart.js").Chart<"doughnut"> | null>(null);
  const [failed, setFailed] = useState(false);
  const view = failed ? "unavailable" : requestedView && requestedView !== "data" ? requestedView : allocation.view;
  useEffect(() => {
    let disposed = false;
    async function render() {
      try {
        const { Chart, DoughnutController, ArcElement, Tooltip } = await import("chart.js");
        if (disposed || !canvas.current) return;
        Chart.register(DoughnutController, ArcElement, Tooltip);
        const entries = view === "data" ? allocation.entries : [];
        const data = { labels: entries.map((entry) => entry.symbol), datasets: [{ data: entries.map((entry) => entry.percent), backgroundColor: entries.map((entry) => entry.color), hoverBackgroundColor: entries.map((entry) => entry.color), borderColor: "#ffffff", hoverBorderColor: "#ffffff", borderWidth: 2, hoverOffset: 0 }] };
        if (instance.current) {
          instance.current.data = data;
          instance.current.update("none");
        } else {
          instance.current = new Chart(canvas.current, { type: "doughnut", data, options: {
            responsive: true, maintainAspectRatio: false, cutout: "72%", animation: false,
            plugins: { tooltip: { displayColors: false, callbacks: { label: (context) => `${Number(context.raw).toFixed(1)}%` } } },
          } });
        }
      } catch { if (!disposed) setFailed(true); }
    }
    void render();
    return () => { disposed = true; };
  }, [allocation, view]);
  useEffect(() => () => { instance.current?.destroy(); instance.current = null; }, []);
  return (
    <section aria-labelledby="portfolio-heading" aria-describedby="portfolio-description" className="border-b border-slate-200 p-4">
      <header className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <h3 id="portfolio-heading" className="text-xs font-semibold text-slate-700">Portfolio Allocation</h3>
        <p id="portfolio-description" className="text-xs text-slate-500">종목별 사용 증거금 비중 · 포지션 예시 데이터</p>
      </header>
      <div data-portfolio-frame data-view={view} aria-busy={view === "loading"} className="relative grid min-h-96 w-full max-w-3xl grid-cols-1 items-center gap-4 sm:min-h-56 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-8">
        <figure aria-labelledby="portfolio-caption" aria-hidden={view !== "data"} className={`flex flex-col items-center gap-2 ${view !== "data" ? "invisible" : ""}`}>
          <div data-doughnut-mount role="img" aria-label="종목별 사용 증거금 비중 Doughnut Chart 영역" className="relative size-44 shrink-0 sm:size-48">
            <canvas ref={canvas} aria-hidden="true" />
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-500">증거금 구성</span>
          </div>
          <figcaption id="portfolio-caption" className="text-xs text-slate-500">사용 증거금 구성</figcaption>
        </figure>
        {view === "data" && (
          <dl aria-label="종목별 증거금과 비중" className="w-full min-w-0 text-xs tabular-nums">
            {allocation.entries.map((entry) => (
              <div key={entry.symbol} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-slate-100 py-3 last:border-b-0">
                <dt className="flex items-center gap-2 font-medium"><span aria-hidden="true" className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: entry.color }} />{entry.symbol}</dt>
                <dd className="text-right font-semibold">{entry.percent.toFixed(1)}%</dd>
                <dd className="col-span-2 break-all pl-4.5 text-slate-500">{formatMargin(entry.margin)}</dd>
              </div>
            ))}
          </dl>
        )}
        {view === "loading" && <ChartState title="포트폴리오를 불러오는 중입니다." />}
        {view === "empty" && <ChartState title={positions.length ? "사용 중인 증거금이 없습니다." : "보유 중인 포지션이 없습니다."} />}
        {view === "unavailable" && <ChartState title="포트폴리오를 표시할 수 없습니다." />}
      </div>
    </section>
  );
}
