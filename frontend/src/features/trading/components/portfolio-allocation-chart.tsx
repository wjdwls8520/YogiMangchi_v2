import { previewPositions } from "../preview-data";
import { ChartState, type PortfolioChartView } from "./chart-state";

export function PortfolioAllocationChart({ view = "data" }: { view?: PortfolioChartView }) {
  return (
    <section aria-labelledby="portfolio-heading" aria-describedby="portfolio-description" className="border-b border-slate-200 p-4">
      <header className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <h3 id="portfolio-heading" className="text-xs font-semibold text-slate-700">Portfolio Allocation</h3>
        <p id="portfolio-description" className="text-xs text-slate-500">종목별 사용 증거금 비중 · 포지션 예시 데이터</p>
      </header>
      <div data-portfolio-frame aria-busy={view === "loading"} className="relative grid min-h-96 w-full max-w-3xl grid-cols-1 items-center gap-4 sm:min-h-56 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-8">
        <figure aria-labelledby="portfolio-caption" className="flex flex-col items-center gap-2">
          <div data-doughnut-mount role="img" aria-label="종목별 사용 증거금 비중 Doughnut Chart 영역" className="relative size-44 shrink-0 sm:size-48">
            <svg viewBox="0 0 192 192" fill="none" aria-hidden="true" className="size-full">
              <circle cx="96" cy="96" r="72" stroke="#e2e8f0" strokeWidth="24" />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-xs text-slate-500">증거금 구성</span>
          </div>
          <figcaption id="portfolio-caption" className="text-xs text-slate-500">사용 증거금 구성</figcaption>
        </figure>
        {view === "data" && (
          <dl aria-label="종목별 증거금과 비중" className="w-full min-w-0 text-xs tabular-nums">
            {previewPositions.map((position, index) => (
              <div key={position.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-slate-100 py-3 last:border-b-0">
                <dt className="flex items-center gap-2 font-medium"><span aria-hidden="true" className={`size-2.5 shrink-0 rounded-sm ${index === 0 ? "bg-brand-600" : "bg-slate-600"}`} />{position.symbol}</dt>
                <dd className="text-right font-semibold">비중 —</dd>
                <dd className="col-span-2 pl-4.5 text-slate-500">{position.margin}</dd>
              </div>
            ))}
          </dl>
        )}
        {view === "loading" && <ChartState title="포트폴리오를 불러오는 중입니다." />}
        {view === "empty" && <ChartState title="보유 중인 포지션이 없습니다." />}
        {view === "unavailable" && <ChartState title="포트폴리오를 표시할 수 없습니다." />}
      </div>
    </section>
  );
}
