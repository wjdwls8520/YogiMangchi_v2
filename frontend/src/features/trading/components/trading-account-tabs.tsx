import { previewAccount, previewPositions } from "../preview-data";
import { OrderHistoryTable, PendingOrderTable, PositionTable } from "./account-tables";
import { PortfolioAllocationChart } from "./portfolio-allocation-chart";
import { TradingNavigation, type TradingTab } from "./trading-navigation";

export type AccountView = "positions" | "orders" | "portfolio";
const accountTabs: readonly TradingTab[] = [
  { id: "positions", label: "Positions", controls: "positions", count: 2 },
  { id: "orders", label: "Orders", controls: "orders", count: 1 },
  { id: "portfolio", label: "Portfolio", controls: "portfolio-view" },
];

export function TradingAccountTabs({ activeTab = "positions", onSelect }: {
  activeTab?: AccountView;
  onSelect?: (view: AccountView) => void;
}) {
  const select = onSelect ? (id: string) => {
    if (id === "positions" || id === "orders" || id === "portfolio") onSelect(id);
  } : undefined;
  return (
    <section id="trading-account" aria-label="내 모의투자 · 예시 계정" aria-describedby="preview-notice" className="trading-account trading-section" data-account-view={activeTab}>
      <TradingNavigation label="데스크톱 거래 내역" prefix="desktop-account" tabs={accountTabs} activeId={activeTab} onSelect={select} className="desktop-account-navigation" />
      <TradingNavigation label="주문 화면 거래 내역" prefix="mobile-account" tabs={accountTabs.slice(0, 2)} activeId={activeTab === "portfolio" ? "positions" : activeTab} onSelect={select} className="mobile-account-navigation" />
      <section id="positions" role="tabpanel" aria-labelledby="positions-heading" tabIndex={0} className="account-content account-records">
        <h3 id="positions-heading" className="account-records-heading">Positions <span>보유 포지션 · 예시</span></h3>
        <PositionTable />
      </section>
      <section id="orders" role="tabpanel" aria-labelledby="orders-heading" tabIndex={0} className="account-content">
        <section id="pending-orders" aria-labelledby="orders-heading" className="account-records">
          <h3 id="orders-heading" className="account-records-heading">Pending Orders <span>미체결 주문 · 예시</span></h3>
          <PendingOrderTable />
        </section>
        <section id="order-history" aria-labelledby="history-heading" className="account-records">
          <h3 id="history-heading" className="account-records-heading">Order History <span>주문 내역 · 예시</span></h3>
          <OrderHistoryTable />
        </section>
      </section>
      <section id="portfolio-view" role="tabpanel" aria-labelledby="portfolio-summary-heading" tabIndex={0} className="account-content portfolio-view">
        <header className="section-heading"><h2 id="portfolio-summary-heading" className="section-title">Portfolio</h2><span className="preview-label">예시 계정</span></header>
        <dl className="account-summary">
          <div><dt>총 평가 자산</dt><dd>{previewAccount.equity} <span>USDT</span></dd></div>
          <div><dt>사용 가능 자산</dt><dd>{previewAccount.available} <span>USDT</span></dd></div>
          <div><dt>사용 중인 증거금</dt><dd>{previewAccount.margin} <span>USDT</span></dd></div>
          <div><dt>미실현 손익</dt><dd data-trend="up">{previewAccount.unrealizedPnl} <span>USDT</span></dd></div>
        </dl>
        <PortfolioAllocationChart positions={previewPositions} />
      </section>
    </section>
  );
}
