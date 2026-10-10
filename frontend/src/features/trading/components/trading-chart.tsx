export function TradingChart() {
  return (
    <section aria-labelledby="chart-heading">
      <header>
        <h2 id="chart-heading">차트 <span>BTC / USDT</span></h2>
        <span>정적 예시</span>
      </header>
      <div role="group" aria-label="차트 주기 (미리보기)">
        {["1m", "5m", "15m", "1h", "4h", "1d"].map((timeframe) => (
          <button key={timeframe} type="button" disabled aria-pressed={timeframe === "1h"}>
            {timeframe}
          </button>
        ))}
      </div>
      <figure aria-labelledby="chart-caption">
        {/* Replace this static interior with Lightweight Charts in the integration phase. */}
        <div data-chart-mount>
          <p>BTC / USDT 가격 차트 영역</p>
        </div>
        <figcaption id="chart-caption">1시간봉 · 화면 확인용 예시 차트</figcaption>
      </figure>
    </section>
  );
}
