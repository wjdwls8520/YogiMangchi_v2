import { useTradingOrders, useTradingSummary } from "../api/queries";
import { formatDecimal, pnlTrend, portfolioPositions } from "../api/account";
import type { TradingSymbol } from "../market/catalog";
import { AccountQueryState } from "./account-query-state";
import { OrderHistoryTable, PendingOrderTable, PositionTable } from "./account-tables";
import { PortfolioAllocationChart } from "./portfolio-allocation-chart";
import { TradingNavigation, type TradingTab } from "./trading-navigation";

export type AccountView = "positions" | "orders" | "portfolio";

export function TradingAccountTabs({ activeTab = "positions", onSelect, symbols }: {
  symbols: readonly TradingSymbol[];
  activeTab?: AccountView;
  onSelect?: (view: AccountView) => void;
}) {
  const query = useTradingSummary();
  const pending = useTradingOrders("pending");
  const history = useTradingOrders("history");
  const wallet = query.data?.wallet;
  const positions = query.data?.positions ?? [];
  const accountTabs: readonly TradingTab[] = [
    { id: "positions", label: "Positions", controls: "positions", count: query.data ? positions.length : undefined },
    { id: "orders", label: "Orders", controls: "orders", count: pending.data?.length },
    { id: "portfolio", label: "Portfolio", controls: "portfolio-view" },
  ];
  const select = onSelect ? (id: string) => {
    if (id === "positions" || id === "orders" || id === "portfolio") onSelect(id);
  } : undefined;
  return (
    <section id="trading-account" aria-label="내 모의투자 계정" aria-describedby="preview-notice" className="trading-account trading-section" data-account-view={activeTab}>
      <TradingNavigation label="데스크톱 거래 내역" prefix="desktop-account" tabs={accountTabs} activeId={activeTab} onSelect={select} className="desktop-account-navigation" />
      <TradingNavigation label="주문 화면 거래 내역" prefix="mobile-account" tabs={accountTabs.slice(0, 2)} activeId={activeTab === "portfolio" ? "positions" : activeTab} onSelect={select} className="mobile-account-navigation" />
      <section id="positions" role="tabpanel" aria-labelledby="positions-heading" tabIndex={0} className="account-content account-records">
        <h3 id="positions-heading" className="account-records-heading">Positions <span>보유 포지션 · 조회 시점 기준</span><button className="account-refresh" type="button" disabled={query.busy} onClick={query.retry}>새로고침</button></h3>
        <AccountQueryState loading={query.loading} error={query.error} empty={query.data && !positions.length ? "보유 중인 포지션이 없습니다." : undefined} onRetry={query.retry} busy={query.busy} />
        {query.data && positions.length > 0 && <PositionTable positions={positions} symbols={symbols} />}
      </section>
      <section id="orders" role="tabpanel" aria-labelledby="orders-heading" tabIndex={0} className="account-content">
        <section id="pending-orders" aria-labelledby="orders-heading" className="account-records">
          <h3 id="orders-heading" className="account-records-heading">Pending Orders <span>미체결 주문</span><button className="account-refresh" type="button" disabled={pending.busy} onClick={pending.retry}>새로고침</button></h3>
          <AccountQueryState loading={pending.loading} error={pending.error} empty={pending.data?.length === 0 ? "미체결 주문이 없습니다." : undefined} onRetry={pending.retry} busy={pending.busy} />
          {pending.data && pending.data.length > 0 && <PendingOrderTable orders={pending.data} symbols={symbols} />}
        </section>
        <section id="order-history" aria-labelledby="history-heading" className="account-records">
          <h3 id="history-heading" className="account-records-heading">Order History <span>최근 주문 최대 50건</span><button className="account-refresh" type="button" disabled={history.busy} onClick={history.retry}>새로고침</button></h3>
          <AccountQueryState loading={history.loading} error={history.error} empty={history.data?.length === 0 ? "주문 내역이 없습니다." : undefined} onRetry={history.retry} busy={history.busy} />
          {history.data && history.data.length > 0 && <OrderHistoryTable orders={history.data} symbols={symbols} />}
        </section>
      </section>
      <section id="portfolio-view" role="tabpanel" aria-labelledby="portfolio-summary-heading" tabIndex={0} className="account-content portfolio-view">
        <header className="section-heading"><h2 id="portfolio-summary-heading" className="section-title">Portfolio</h2><button className="account-refresh" type="button" disabled={query.busy} onClick={query.retry}>새로고침</button></header>
        <AccountQueryState loading={query.loading} error={query.error} onRetry={query.retry} busy={query.busy} />
        {wallet && query.data && <>
          <p className="account-snapshot-note">Guest #{query.data.accountId} · {query.data.status} · 평가 시각 <time dateTime={query.data.valuedAt}>{new Date(query.data.valuedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} KST</time>{wallet.valuationStatus !== "FRESH" ? " · 시세 평가 불가: 평가 자산과 손익을 표시할 수 없습니다." : ""}</p>
          <dl className="account-summary">
            <div><dt>총 평가 자산</dt><dd>{formatDecimal(wallet.equity)} <span>USDT</span></dd></div>
            <div><dt>사용 가능 자산</dt><dd>{formatDecimal(wallet.availableBalance)} <span>USDT</span></dd></div>
            <div><dt>사용 중인 증거금</dt><dd>{formatDecimal(wallet.usedMargin)} <span>USDT</span></dd></div>
            <div><dt>미실현 손익</dt><dd data-trend={pnlTrend(wallet.unrealizedPnl)}>{formatDecimal(wallet.unrealizedPnl)} <span>USDT</span></dd></div>
          </dl>
        </>}
        <PortfolioAllocationChart positions={portfolioPositions(positions, symbols)} view={query.error ? "unavailable" : query.loading ? "loading" : "data"} />
      </section>
    </section>
  );
}
