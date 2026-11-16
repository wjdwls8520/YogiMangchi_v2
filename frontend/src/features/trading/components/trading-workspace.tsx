import { MarketChartPanel } from "./market-chart-panel";
import { OrderPanel } from "./order-panel";
import { TradingDataProvider } from "./trading-data-provider";
import { V1Header } from "../../member/components/v1-ui";

export function TradingWorkspace() {
  return (
    <TradingDataProvider>
      <a href="#trading-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-10 focus:bg-terminal-panel focus:px-4 focus:py-3">
        Trading 본문으로 바로가기
      </a>
      <V1Header theme="dark" />
      <main id="trading-main" tabIndex={-1} className="trading-workspace">
        <h1 className="sr-only">선물 모의투자</h1>
        <MarketChartPanel>
          <OrderPanel />
        </MarketChartPanel>
      </main>
    </TradingDataProvider>
  );
}
