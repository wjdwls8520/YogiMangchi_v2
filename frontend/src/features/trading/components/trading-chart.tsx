export function TradingChart() {
  return (
    <section aria-labelledby="chart-heading" className="trading-section flex flex-col">
      <header className="section-heading">
        <h2 id="chart-heading" className="section-title">차트 <span className="ml-2 text-xs font-normal text-slate-500">BTC / USDT</span></h2>
        <span className="preview-label">정적 예시</span>
      </header>
      <div role="group" aria-label="차트 주기 (미리보기)" className="flex min-h-12 flex-wrap items-center gap-1 border-b border-slate-100 px-3 py-1">
        {["1m", "5m", "15m", "1h", "4h", "1d"].map((timeframe) => (
          <button key={timeframe} type="button" disabled aria-pressed={timeframe === "1h"} className="min-h-11 min-w-9 rounded-sm px-2 text-xs font-medium text-slate-500 aria-pressed:bg-brand-50 aria-pressed:text-brand-700">
            {timeframe}
          </button>
        ))}
      </div>
      <figure aria-labelledby="chart-caption" className="flex min-h-80 flex-1 flex-col sm:min-h-96">
        {/* Replace this static interior with Lightweight Charts in the integration phase. */}
        <div data-chart-mount className="relative mx-3 mb-2 mt-4 min-h-64 flex-1 sm:mx-4 sm:min-h-80">
          <p className="text-xs text-slate-500">가격 <span>(USDT)</span></p>
          <div className="absolute bottom-7 left-0 right-16 top-8" aria-hidden="true">
            <svg viewBox="0 0 800 320" preserveAspectRatio="none" className="h-full w-full overflow-visible" fill="none">
              <path d="M0 20H800M0 90H800M0 160H800M0 230H800M0 300H800" stroke="#e2e8f0" vectorEffect="non-scaling-stroke" />
              <path d="M0 0V320M160 0V320M320 0V320M480 0V320M640 0V320M800 0V320" stroke="#f1f5f9" vectorEffect="non-scaling-stroke" />
              <path d="M0 259 20 264 40 248 60 250 80 237 100 247 120 232 140 214 160 221 180 192 200 206 220 202 240 230 260 216 280 223 300 188 320 194 340 178 360 192 380 164 400 173 420 132 440 142 460 133 480 158 500 146 520 163 540 131 560 137 580 115 600 95 620 108 640 79 660 87 680 61 700 75 720 99 740 84 760 105 780 112 800 108V320H0Z" fill="#ecfdf5" />
              <path d="M0 259 20 264 40 248 60 250 80 237 100 247 120 232 140 214 160 221 180 192 200 206 220 202 240 230 260 216 280 223 300 188 320 194 340 178 360 192 380 164 400 173 420 132 440 142 460 133 480 158 500 146 520 163 540 131 560 137 580 115 600 95 620 108 640 79 660 87 680 61 700 75 720 99 740 84 760 105 780 112 800 108" stroke="#047857" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              <path d="M0 108H800" stroke="#047857" strokeDasharray="4 4" strokeOpacity="0.5" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
          <div className="absolute bottom-7 right-0 top-8 flex w-16 flex-col justify-between text-right text-xs tabular-nums text-slate-500" aria-hidden="true">
            <span>65,200</span><span>64,800</span><span>64,400</span><span>64,000</span><span>63,600</span>
          </div>
          <span className="absolute right-0 top-1/3 rounded-sm bg-gain px-1 py-1 text-xs tabular-nums text-white" aria-hidden="true">64,580</span>
          <div className="absolute bottom-0 left-0 right-16 flex justify-between text-xs tabular-nums text-slate-500" aria-hidden="true">
            <span>06:00</span><span>12:00</span><span>18:00</span><span>00:00</span>
          </div>
        </div>
        <figcaption id="chart-caption" className="flex flex-wrap justify-between gap-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          <span>1시간 간격 · 화면 확인용 예시 차트</span><span className="font-medium text-slate-500">BTC / USDT</span>
        </figcaption>
      </figure>
    </section>
  );
}
