import { previewAccount } from "../preview-data";
import { OrderHistoryTable, PendingOrderTable, PositionTable } from "./account-tables";
import { PortfolioAllocationChart } from "./portfolio-allocation-chart";

export function TradingAccountTabs() {
  return (
    <section aria-labelledby="account-heading" aria-describedby="preview-notice" className="trading-section my-4">
      <header className="section-heading"><h2 id="account-heading" className="section-title">내 모의투자</h2><span className="preview-label">예시 계정</span></header>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-5 border-b border-slate-200 px-4 py-5 text-xs tabular-nums sm:grid-cols-4 sm:gap-6 [&_dt]:text-slate-500 [&_dd]:mt-2 [&_dd]:text-base [&_dd]:font-semibold [&_dd]:tracking-tight [&_dd>span]:text-xs [&_dd>span]:font-normal [&_dd>span]:text-slate-500">
        <div><dt>총 평가 자산</dt><dd>{previewAccount.equity} <span>USDT</span></dd></div>
        <div><dt>사용 가능 자산</dt><dd>{previewAccount.available} <span>USDT</span></dd></div>
        <div><dt>사용 중인 증거금</dt><dd>{previewAccount.margin} <span>USDT</span></dd></div>
        <div><dt>미실현 손익</dt><dd data-trend="up">{previewAccount.unrealizedPnl} <span>USDT</span></dd></div>
      </dl>
      <PortfolioAllocationChart />
      {/* Native anchors expose all preview sections without implementing tab state. */}
      <nav aria-label="포지션 및 주문 내역" className="flex border-b border-slate-200">
        <a href="#positions" className="account-tab"><span>Positions</span> <span className="account-tab-count">2</span></a>
        <a href="#pending-orders" className="account-tab"><span>Pending Orders</span> <span className="account-tab-count">1</span></a>
        <a href="#order-history" className="account-tab"><span>Order History</span> <span className="account-tab-count">2</span></a>
      </nav>
      <section id="positions" aria-labelledby="positions-heading" tabIndex={-1} className="min-w-0 scroll-mt-4 target:ring-1 target:ring-inset target:ring-brand-600">
        <h3 id="positions-heading" className="flex min-h-12 items-center gap-2 px-4 text-xs font-semibold text-slate-700">Positions <span className="font-normal text-slate-500">보유 포지션</span></h3>
        <PositionTable />
      </section>
      <section id="pending-orders" aria-labelledby="pending-heading" tabIndex={-1} className="min-w-0 scroll-mt-4 border-t border-slate-200 target:ring-1 target:ring-inset target:ring-brand-600">
        <h3 id="pending-heading" className="flex min-h-12 items-center gap-2 px-4 text-xs font-semibold text-slate-700">Pending Orders <span className="font-normal text-slate-500">미체결 주문</span></h3>
        <PendingOrderTable />
      </section>
      <section id="order-history" aria-labelledby="history-heading" tabIndex={-1} className="min-w-0 scroll-mt-4 border-t border-slate-200 target:ring-1 target:ring-inset target:ring-brand-600">
        <h3 id="history-heading" className="flex min-h-12 items-center gap-2 px-4 text-xs font-semibold text-slate-700">Order History <span className="font-normal text-slate-500">주문 내역</span></h3>
        <OrderHistoryTable />
      </section>
    </section>
  );
}
