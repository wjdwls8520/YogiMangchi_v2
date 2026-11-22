import { MarketChartPanel } from "./market-chart-panel";
import { OrderPanel } from "./order-panel";
import { TradingDataProvider } from "./trading-data-provider";
import { V1Header } from "../../member/components/v1-ui";
import type { AccountView } from "./trading-account-tabs";

export type TradingWorkspaceProps = {
  urlSymbol?: string | null;
  urlTab?: AccountView | null;
  urlSide?: "LONG" | "SHORT" | null;
  urlLeverage?: number | null;
};

export function TradingWorkspace({
  urlSymbol = null,
  urlTab = null,
  urlSide = null,
  urlLeverage = null,
}: TradingWorkspaceProps = {}) {
  return (
    <TradingDataProvider>
      <a href="#trading-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:bg-terminal-panel focus:px-4 focus:py-3">
        모의투자 본문으로 바로가기
      </a>
      <V1Header theme="dark" />
      <main id="trading-main" tabIndex={-1} className="trading-workspace">
        <h1 className="sr-only">선물 모의투자</h1>
        <MarketChartPanel urlSymbol={urlSymbol} urlTab={urlTab}>
          <OrderPanel urlSide={urlSide} urlLeverage={urlLeverage} />
        </MarketChartPanel>
      </main>
    </TradingDataProvider>
  );
}
