"use client";

import { useRef, useState } from "react";
import { useClosedHistory, useFillHistory, useOrderHistory, useTradingOrders, useTradingSummary } from "../api/queries";
import { portfolioPositions } from "../api/account";
import type { TradingSymbol } from "../market/catalog";
import { AccountQueryState } from "./account-query-state";
import { ClosedPositionTable, FillHistoryTable, OrderHistoryTable, PendingOrderTable, PositionTable } from "./account-tables";
import { PortfolioAllocationChart } from "./portfolio-allocation-chart";
import { TradingNavigation, type TradingTab } from "./trading-navigation";
import { useGuestSession } from "./trading-data-provider";
import { WalletOverview } from "./wallet-overview";
import { TradingEventStatus } from "./trading-event-status";
import { emptyHistoryFilters, HistoryFilters } from "./history-filters";
import { SymbolPerformance } from "./symbol-performance";
import { MemberSimulation } from "./member-simulation";

export type AccountView = "positions" | "orders" | "history" | "fills" | "closed" | "portfolio";
function HistoryMore({ hasMore, busy, error, onMore }: { hasMore: boolean; busy: boolean; error: boolean; onMore: () => void }) {
  return hasMore ? <div className="history-more">{error && <p role="alert">다음 내역을 불러오지 못했습니다. 다시 시도해 주세요.</p>}<button type="button" className="account-refresh" disabled={busy} onClick={onMore}>{busy ? "불러오는 중…" : error ? "다음 내역 다시 시도" : "더 보기"}</button></div> : null;
}
export function TradingAccountTabs({ activeTab = "positions", onSelect, symbols }: {
  symbols: readonly TradingSymbol[]; activeTab?: AccountView; onSelect?: (view: AccountView) => void;
}) {
  const query = useTradingSummary(), pending = useTradingOrders("pending");
  const [orderFilters, setOrderFilters] = useState({ ...emptyHistoryFilters });
  const [fillFilters, setFillFilters] = useState({ ...emptyHistoryFilters });
  const [closedFilters, setClosedFilters] = useState({ ...emptyHistoryFilters });
  const ordersPage = useOrderHistory(orderFilters, activeTab === "history");
  const fillsPage = useFillHistory(fillFilters, activeTab === "fills");
  const closedPage = useClosedHistory(closedFilters, activeTab === "closed");
  const { snapshot } = useGuestSession();
  const body = useRef<HTMLDivElement>(null);
  const positions = query.data?.positions ?? [];
  const tabs: readonly TradingTab[] = [
    {id:"positions",label:"포지션",controls:"positions",count:query.data ? positions.length : undefined},
    {id:"orders",label:"미체결 주문",controls:"orders",count:pending.data?.length},
    {id:"history",label:"주문 내역",controls:"order-history"},
    {id:"fills",label:"체결 내역",controls:"fill-history"},
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
      <p>{snapshot.mode === "member" ? "주문창에서 회원 선물 계정을 열면 이용할 수 있습니다." : "로그인 또는 게스트로 참여하면 이용할 수 있습니다."}</p>
    </div> : <>
      <TradingEventStatus key={`${snapshot.accountId}:${snapshot.generation}`} />
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
        <h3 className="account-records-heading">주문 내역 <span>서버 주문 상태 · 50건씩 조회</span><button className="account-refresh" disabled={ordersPage.busy} onClick={ordersPage.retry}>새로고침</button></h3>
        <HistoryFilters kind="orders" value={orderFilters} onChange={setOrderFilters} symbols={symbols} />
        <AccountQueryState loading={ordersPage.loading} error={ordersPage.error} empty={ordersPage.items?.length===0 ? "주문 내역이 없습니다." : undefined} onRetry={ordersPage.retry} busy={ordersPage.busy} />
        {ordersPage.items && ordersPage.items.length>0 && <OrderHistoryTable orders={ordersPage.items} symbols={symbols} />}
        <HistoryMore hasMore={!!ordersPage.hasMore} busy={ordersPage.busy} error={ordersPage.moreError} onMore={ordersPage.loadMore} />
      </section>
      <section hidden={activeTab !== "fills"} id="fill-history" className="activity-panel" role="tabpanel" aria-labelledby="activity-fills-tab">
        <h3 className="account-records-heading">체결 내역 <span>부분 청산과 강제청산 포함 · 50건씩 조회</span><button className="account-refresh" disabled={fillsPage.busy} onClick={fillsPage.retry}>새로고침</button></h3>
        <HistoryFilters kind="fills" value={fillFilters} onChange={setFillFilters} symbols={symbols} />
        <AccountQueryState loading={fillsPage.loading} error={fillsPage.error} empty={fillsPage.items?.length===0 ? "체결 내역이 없습니다." : undefined} onRetry={fillsPage.retry} busy={fillsPage.busy} />
        {fillsPage.items && fillsPage.items.length>0 && <FillHistoryTable fills={fillsPage.items} symbols={symbols} />}
        <HistoryMore hasMore={!!fillsPage.hasMore} busy={fillsPage.busy} error={fillsPage.moreError} onMore={fillsPage.loadMore} />
      </section>
      <section hidden={activeTab !== "closed"} id="closed-positions" className="activity-panel" role="tabpanel" aria-labelledby="activity-closed-tab">
        <h3 className="account-records-heading">포지션 내역 <span>종료된 포지션 단위 · 50건씩 조회</span><button className="account-refresh" disabled={closedPage.busy} onClick={closedPage.retry}>새로고침</button></h3>
        <HistoryFilters kind="closed" value={closedFilters} onChange={setClosedFilters} symbols={symbols} />
        <AccountQueryState loading={closedPage.loading} error={closedPage.error} empty={closedPage.items?.length===0 ? "종료된 포지션이 없습니다." : undefined} onRetry={closedPage.retry} busy={closedPage.busy} />
        {closedPage.items && closedPage.items.length>0 && <ClosedPositionTable positions={closedPage.items} symbols={symbols} />}
        <HistoryMore hasMore={!!closedPage.hasMore} busy={closedPage.busy} error={closedPage.moreError} onMore={closedPage.loadMore} />
      </section>
      <section hidden={activeTab !== "portfolio"} id="portfolio-view" className="activity-panel" role="tabpanel" aria-labelledby="activity-portfolio-tab">
        <AccountQueryState loading={query.loading} error={query.error} onRetry={query.retry} busy={query.busy} />
        {query.data && <WalletOverview wallet={query.data.wallet} layout="grid" />}
        <PortfolioAllocationChart positions={portfolioPositions(positions,symbols)} view={query.error ? "unavailable" : query.loading ? "loading" : "data"} />
        {activeTab === "portfolio" && <SymbolPerformance />}
        {snapshot.mode === "member" && activeTab === "portfolio" && <MemberSimulation />}
      </section>
    </>}
    </div>
  </section>;
}
