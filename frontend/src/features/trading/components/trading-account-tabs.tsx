import { previewAccount } from "../preview-data";
import { OrderHistoryTable, PendingOrderTable, PositionTable } from "./account-tables";

export function TradingAccountTabs() {
  return (
    <section aria-labelledby="account-heading" aria-describedby="preview-notice">
      <header><h2 id="account-heading">내 모의투자</h2><span>예시 계정</span></header>
      <dl>
        <div><dt>총 평가 자산</dt><dd>{previewAccount.equity} <span>USDT</span></dd></div>
        <div><dt>사용 가능 자산</dt><dd>{previewAccount.available} <span>USDT</span></dd></div>
        <div><dt>사용 중인 증거금</dt><dd>{previewAccount.margin} <span>USDT</span></dd></div>
        <div><dt>미실현 손익</dt><dd data-trend="up">{previewAccount.unrealizedPnl} <span>USDT</span></dd></div>
      </dl>
      {/* Native anchors expose all preview sections without implementing tab state. */}
      <nav aria-label="포지션 및 주문 내역">
        <a href="#positions">Positions <span>2</span></a>
        <a href="#pending-orders">Pending Orders <span>1</span></a>
        <a href="#order-history">Order History <span>2</span></a>
      </nav>
      <section id="positions" aria-labelledby="positions-heading" tabIndex={-1}>
        <h3 id="positions-heading">Positions <span>보유 포지션</span></h3>
        <PositionTable />
      </section>
      <section id="pending-orders" aria-labelledby="pending-heading" tabIndex={-1}>
        <h3 id="pending-heading">Pending Orders <span>미체결 주문</span></h3>
        <PendingOrderTable />
      </section>
      <section id="order-history" aria-labelledby="history-heading" tabIndex={-1}>
        <h3 id="history-heading">Order History <span>주문 내역</span></h3>
        <OrderHistoryTable />
      </section>
    </section>
  );
}
