import { MarketHeader } from "./market-header";
import { SymbolSelector } from "./symbol-selector";
import { TradingChart } from "./trading-chart";
import { OrderPanel } from "./order-panel";
import { TradingAccountTabs } from "./trading-account-tabs";

export function TradingWorkspace() {
  return (
    <>
      <a href="#trading-main" className="sr-only focus:not-sr-only">
        Trading 본문으로 바로가기
      </a>
      <header>
        <p>요기망치 <span>YOGIMANGCHI</span></p>
        <p>선물 모의투자</p>
        <span>UI 미리보기</span>
      </header>
      <main id="trading-main" tabIndex={-1}>
        <div>
          <h1>선물 모의투자</h1>
          <p id="preview-notice">표시된 가격과 거래 내역은 예시입니다. 주문은 실행되지 않습니다.</p>
        </div>
        <MarketHeader />
        <SymbolSelector />
        <div>
          <TradingChart />
          <OrderPanel />
        </div>
        <TradingAccountTabs />
      </main>
      <footer>
        <p>YOGIMANGCHI · 선물 모의투자</p>
        <p>실제 자금을 사용하지 않는 모의투자 화면입니다.</p>
      </footer>
    </>
  );
}
