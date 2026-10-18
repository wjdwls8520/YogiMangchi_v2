"use client";

import { useRef } from "react";
import { useTradingOrders, useTradingSummary } from "../api/queries";
import { portfolioPositions } from "../api/account";
import type { TradingSymbol } from "../market/catalog";
import { AccountQueryState } from "./account-query-state";
import { OrderHistoryTable, PendingOrderTable, PositionTable } from "./account-tables";
import { PortfolioAllocationChart } from "./portfolio-allocation-chart";
import { TradingNavigation, type TradingTab } from "./trading-navigation";
import { useGuestSession } from "./trading-data-provider";
import { WalletOverview } from "./wallet-overview";
import { LiquidationFeedback } from "./liquidation-feedback";

export type AccountView = "positions" | "orders" | "history" | "closed" | "portfolio";
export function TradingAccountTabs({ activeTab = "positions", onSelect, symbols }: {
  symbols: readonly TradingSymbol[]; activeTab?: AccountView; onSelect?: (view: AccountView) => void;
}) {
  const query = useTradingSummary(), pending = useTradingOrders("pending"), history = useTradingOrders("history");
  const { snapshot } = useGuestSession();
  const body = useRef<HTMLDivElement>(null);
  const positions = query.data?.positions ?? [];
  const tabs: readonly TradingTab[] = [
    {id:"positions",label:"포지션",controls:"positions",count:query.data ? positions.length : undefined},
    {id:"orders",label:"미체결 주문",controls:"orders",count:pending.data?.length},
    {id:"history",label:"주문 내역",controls:"order-history"},
    {id:"closed",label:"포지션 내역",controls:"closed-positions"},
    {id:"portfolio",label:"자산",controls:"portfolio-view"},
  ];
  const select = (value: string) => {
    if (!tabs.some(tab=>tab.id===value)) return;
    if (value !== activeTab) body.current?.scrollTo({ top: 0 });
    onSelect?.(value as AccountView);
  };
  return <section id="trading-account" aria-label="Trading Activity" className="trading-account trading-section" data-account-view={activeTab} data-guest={snapshot.phase !== "ready"}>
    <TradingNavigation label="거래 활동" prefix="activity" tabs={snapshot.phase === "ready" ? tabs : tabs.map(tab => ({ ...tab, controls: "guest-activity-panel" }))} activeId={activeTab} onSelect={onSelect ? select : undefined} />
    <div ref={body} className="trading-account-body" role="region" aria-label="거래 활동 내용" tabIndex={0}>
    {snapshot.phase !== "ready" ? <div className="guest-account-message" id="guest-activity-panel" role="tabpanel" aria-labelledby={`activity-${activeTab}-tab`}>
      <p>로그인 또는 게스트로 참여하면 이용할 수 있습니다.</p>
    </div> : <>
      <LiquidationFeedback orders={history.data} identity={`${snapshot.accountId}:${snapshot.generation}`} symbols={symbols} />
      <section hidden={activeTab !== "positions"} id="positions" className="activity-panel" role="tabpanel" aria-labelledby="activity-positions-tab">
        <h3 className="account-records-heading">보유 포지션 <span>Mark · PnL은 참고 표시, 수량·증거금은 서버 기준</span><button className="account-refresh" disabled={query.busy} onClick={query.retry}>새로고침</button></h3>
        <AccountQueryState loading={query.loading} error={query.error} empty={query.data && !positions.length ? "보유 중인 포지션이 없습니다." : undefined} onRetry={query.retry} busy={query.busy} />
        {query.data && positions.length > 0 && <PositionTable positions={positions} symbols={symbols} />}
      </section>
      <section hidden={activeTab !== "orders"} id="orders" className="activity-panel" role="tabpanel" aria-labelledby="activity-orders-tab">
        <h3 className="account-records-heading">미체결 주문 <span>OPEN · 신규 진입 / CLOSE · 청산 예약</span><button className="account-refresh" disabled={pending.busy} onClick={pending.retry}>새로고침</button></h3>
        <AccountQueryState loading={pending.loading} error={pending.error} empty={pending.data?.length===0 ? "미체결 주문이 없습니다." : undefined} onRetry={pending.retry} busy={pending.busy} />
        {pending.data && pending.data.length > 0 && <PendingOrderTable orders={pending.data} symbols={symbols} />}
      </section>
      <section hidden={activeTab !== "history"} id="order-history" className="activity-panel" role="tabpanel" aria-labelledby="activity-history-tab">
        <h3 className="account-records-heading">주문 내역 <span>최근 최대 50건 · 서버 체결 결과</span><button className="account-refresh" disabled={history.busy} onClick={history.retry}>새로고침</button></h3>
        <AccountQueryState loading={history.loading} error={history.error} empty={history.data?.length===0 ? "주문 내역이 없습니다." : undefined} onRetry={history.retry} busy={history.busy} />
        {history.data && history.data.length>0 && <OrderHistoryTable orders={history.data} symbols={symbols} />}
      </section>
      <section hidden={activeTab !== "closed"} id="closed-positions" className="activity-panel account-query-state" role="tabpanel" aria-labelledby="activity-closed-tab">
        <p>포지션 내역을 준비 중입니다. 현재 체결 기록은 주문 내역에서 확인할 수 있습니다.</p><button className="account-refresh" onClick={()=>select("history")}>주문 내역 보기</button>
      </section>
      <section hidden={activeTab !== "portfolio"} id="portfolio-view" className="activity-panel" role="tabpanel" aria-labelledby="activity-portfolio-tab">
        <AccountQueryState loading={query.loading} error={query.error} onRetry={query.retry} busy={query.busy} />
        {query.data && <WalletOverview wallet={query.data.wallet} />}
        <PortfolioAllocationChart positions={portfolioPositions(positions,symbols)} view={query.error ? "unavailable" : query.loading ? "loading" : "data"} />
      </section>
    </>}
    </div>
  </section>;
}
