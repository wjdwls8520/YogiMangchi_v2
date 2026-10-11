import { previewAccount, previewPositions } from "../preview-data";
import { OrderHistoryTable, PendingOrderTable, PositionTable } from "./account-tables";
import { PortfolioAllocationChart } from "./portfolio-allocation-chart";

export function TradingAccountTabs() {
  return (
    <section aria-labelledby="account-heading" aria-describedby="preview-notice" className="trading-account trading-section">
      <header className="section-heading"><h2 id="account-heading" className="section-title">내 모의투자</h2><span className="preview-label">예시 계정</span></header>
      <dl className="account-summary">
        <div><dt>총 평가 자산</dt><dd>{previewAccount.equity} <span>USDT</span></dd></div>
        <div><dt>사용 가능 자산</dt><dd>{previewAccount.available} <span>USDT</span></dd></div>
        <div><dt>사용 중인 증거금</dt><dd>{previewAccount.margin} <span>USDT</span></dd></div>
        <div><dt>미실현 손익</dt><dd data-trend="up">{previewAccount.unrealizedPnl} <span>USDT</span></dd></div>
      </dl>
      {/* Native anchors expose all preview sections without implementing tab state. */}
      <nav aria-label="포지션 및 주문 내역" className="account-navigation">
        <a href="#positions" className="account-tab"><span>Positions</span> <span className="account-tab-count">2</span></a>
        <a href="#pending-orders" className="account-tab"><span>Pending Orders</span> <span className="account-tab-count">1</span></a>
        <a href="#order-history" className="account-tab"><span>Order History</span> <span className="account-tab-count">2</span></a>
      </nav>
      <section id="positions" aria-labelledby="positions-heading" tabIndex={-1} className="account-records">
        <h3 id="positions-heading" className="account-records-heading">Positions <span>보유 포지션</span></h3>
        <PositionTable />
      </section>
      <section id="pending-orders" aria-labelledby="pending-heading" tabIndex={-1} className="account-records">
        <h3 id="pending-heading" className="account-records-heading">Pending Orders <span>미체결 주문</span></h3>
        <PendingOrderTable />
      </section>
      <section id="order-history" aria-labelledby="history-heading" tabIndex={-1} className="account-records">
        <h3 id="history-heading" className="account-records-heading">Order History <span>주문 내역</span></h3>
        <OrderHistoryTable />
      </section>
      <PortfolioAllocationChart positions={previewPositions} />
    </section>
  );
}
