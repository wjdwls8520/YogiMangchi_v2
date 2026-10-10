import { ChartState, type MarketChartView } from "./chart-state";

const messages = {
  loading: "시세를 불러오는 중입니다.",
  unavailable: "현재 유효한 시세를 제공할 수 없습니다.",
  empty: "표시할 가격 데이터가 없습니다.",
} as const;

export function TradingChart({ view = "loading" }: { view?: MarketChartView }) {
  return (
    <section aria-labelledby="chart-heading" className="trading-section flex flex-col">
      <header className="section-heading">
        <h2 id="chart-heading" className="section-title">차트 <span className="ml-2 text-xs font-normal text-slate-500">BTC / USDT</span></h2>
        <span className="preview-label">연결 대기</span>
      </header>
      <div role="group" aria-label="차트 주기 (현재 미지원)" className="flex min-h-12 flex-wrap items-center gap-1 border-b border-slate-100 px-3 py-1">
        {["1m", "5m", "15m", "1h", "4h", "1d"].map((timeframe) => (
          <button key={timeframe} type="button" disabled className="min-h-11 min-w-9 rounded-sm px-2 text-xs font-medium text-slate-500">
            {timeframe}
          </button>
        ))}
        <span className="px-2 text-xs text-slate-500">Timeframe 미지원</span>
      </div>
      <figure aria-labelledby="chart-caption" className="flex min-h-80 flex-1 flex-col sm:min-h-96">
        <div data-market-chart-frame data-view={view} aria-busy={view === "loading"} className="relative min-h-80 flex-1 sm:min-h-96">
          <div data-chart-mount aria-label="BTC / USDT Mark Price 선 그래프" role="img" className="absolute inset-0 overflow-hidden" />
          {view !== "ready" && <ChartState title={messages[view]} />}
        </div>
        <figcaption id="chart-caption" className="flex flex-wrap justify-between gap-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          <span>Mark Price · 접속 후 수신한 가격 흐름</span>
          <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts™</a>
        </figcaption>
      </figure>
    </section>
  );
}
