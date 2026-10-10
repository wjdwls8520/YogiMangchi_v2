import { previewPositions } from "../preview-data";
import { ChartState, type PortfolioChartView } from "./chart-state";

export function PortfolioAllocationChart({ view = "data" }: { view?: PortfolioChartView }) {
  return (
    <section aria-labelledby="portfolio-heading" aria-describedby="portfolio-description">
      <header>
        <h3 id="portfolio-heading">Portfolio Allocation</h3>
        <p id="portfolio-description">종목별 사용 증거금 비중 · 포지션 예시 데이터</p>
      </header>
      <div data-portfolio-frame aria-busy={view === "loading"}>
        <figure aria-labelledby="portfolio-caption">
          <div data-doughnut-mount role="img" aria-label="종목별 사용 증거금 비중 Doughnut Chart 영역" />
          <figcaption id="portfolio-caption">사용 증거금 구성</figcaption>
        </figure>
        {view === "data" && (
          <dl aria-label="종목별 증거금과 비중">
            {previewPositions.map((position) => (
              <div key={position.id}>
                <dt>{position.symbol}</dt>
                <dd>{position.margin}</dd>
                <dd>비중 —</dd>
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
