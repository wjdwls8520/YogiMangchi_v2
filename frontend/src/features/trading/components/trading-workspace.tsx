import { MarketChartPanel } from "./market-chart-panel";
import { OrderPanel } from "./order-panel";
import { TradingDataProvider } from "./trading-data-provider";

export function TradingWorkspace() {
  return (
    <>
      <a href="#trading-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-10 focus:bg-white focus:px-4 focus:py-3">
        Trading 본문으로 바로가기
      </a>
      <header className="trading-brand-header">
        <div className="trading-brand-bar">
          <p className="trading-brand-name">
            <span className="trading-brand-mark" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="m8 4 4-1 8 8-1 4-3 1-8-8V4Z" fill="currentColor" />
                <path d="m11 11-7 8" stroke="currentColor" strokeWidth="3" strokeLinecap="square" />
              </svg>
            </span>
            요기망치 <span className="trading-brand-latin">YOGIMANGCHI</span>
          </p>
          <p className="hidden text-xs font-medium text-slate-600 md:block">선물 모의투자</p>
          <span className="preview-label">Guest 조회</span>
        </div>
      </header>
      <main id="trading-main" tabIndex={-1} className="trading-workspace">
        <div className="trading-page-intro">
          <h1 className="sr-only">선물 모의투자</h1>
          <p id="preview-notice">차트는 실시간 시세, 계정·포지션·주문 내역은 실제 Guest 조회 데이터입니다. 종목 가격 요약과 24h 통계는 예시이며 주문·청산·취소는 비활성 상태입니다.</p>
        </div>
        <TradingDataProvider><MarketChartPanel>
          <OrderPanel />
        </MarketChartPanel></TradingDataProvider>
      </main>
      <footer className="trading-footer">
        <p className="font-medium tracking-wide">YOGIMANGCHI · 선물 모의투자</p>
        <p>실제 자금을 사용하지 않는 모의투자 화면입니다.</p>
      </footer>
    </>
  );
}
