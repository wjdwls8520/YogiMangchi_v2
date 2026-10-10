import { MarketHeader } from "./market-header";
import { MarketChartPanel } from "./market-chart-panel";
import { OrderPanel } from "./order-panel";
import { TradingAccountTabs } from "./trading-account-tabs";

export function TradingWorkspace() {
  return (
    <>
      <a href="#trading-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-10 focus:bg-white focus:px-4 focus:py-3">
        Trading 본문으로 바로가기
      </a>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex min-h-16 max-w-screen-2xl items-center justify-between gap-3 px-3 sm:px-5 xl:px-8">
          <p className="flex items-center gap-2.5 text-lg font-bold tracking-tight">
            <span className="flex size-8 items-center justify-center rounded-sm bg-brand-600 text-white" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="m8 4 4-1 8 8-1 4-3 1-8-8V4Z" fill="currentColor" />
                <path d="m11 11-7 8" stroke="currentColor" strokeWidth="3" strokeLinecap="square" />
              </svg>
            </span>
            요기망치 <span className="hidden border-l border-slate-200 pl-3 text-xs font-medium tracking-widest text-slate-500 sm:inline">YOGIMANGCHI</span>
          </p>
          <p className="hidden text-sm font-medium text-slate-600 md:block">선물 모의투자</p>
          <span className="preview-label">UI 미리보기</span>
        </div>
      </header>
      <main id="trading-main" tabIndex={-1} className="mx-auto max-w-screen-2xl px-3 py-4 sm:px-5 sm:py-5 xl:px-8 xl:py-6">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <h1 className="text-xl font-bold tracking-tight">선물 모의투자</h1>
          <p id="preview-notice" className="max-w-prose text-xs leading-relaxed text-slate-500">차트만 Trading Server 시세를 사용합니다. 나머지 가격·계정·거래 내역은 예시이며 주문은 실행되지 않습니다.</p>
        </div>
        <MarketHeader />
        <MarketChartPanel>
          <OrderPanel />
        </MarketChartPanel>
        <TradingAccountTabs />
      </main>
      <footer className="mx-auto flex max-w-screen-2xl flex-col gap-2 px-3 pb-6 pt-2 text-xs text-slate-500 sm:flex-row sm:justify-between sm:px-5 xl:px-8">
        <p className="font-medium tracking-wide">YOGIMANGCHI · 선물 모의투자</p>
        <p>실제 자금을 사용하지 않는 모의투자 화면입니다.</p>
      </footer>
    </>
  );
}
