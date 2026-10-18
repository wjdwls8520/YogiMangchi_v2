import { MarketChartPanel } from "./market-chart-panel";
import { OrderPanel } from "./order-panel";
import { TradingDataProvider } from "./trading-data-provider";
import { GuestHeaderAction } from "./guest-access";

export function TradingWorkspace() {
  return (
    <TradingDataProvider>
      <a href="#trading-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-10 focus:bg-terminal-panel focus:px-4 focus:py-3">
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
          <p className="trading-header-product">선물 모의투자</p>
          <GuestHeaderAction />
        </div>
      </header>
      <main id="trading-main" tabIndex={-1} className="trading-workspace">
        <div className="trading-page-intro">
          <h1 className="sr-only">선물 모의투자</h1>
          <p id="preview-notice">서버의 실시간 Mark Price와 실제 24h 통계를 사용합니다. Guest 주문·부분/전체 청산·취소가 가능합니다. 실제 자금을 사용하지 않는 모의투자입니다.</p>
        </div>
        <MarketChartPanel>
          <OrderPanel />
        </MarketChartPanel>
      </main>
    </TradingDataProvider>
  );
}
