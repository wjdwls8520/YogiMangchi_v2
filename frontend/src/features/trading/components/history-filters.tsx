"use client";

import type { TradingSymbol } from "../market/catalog";
import { validHistoryDates, type HistoryFilters as Filters, type HistoryKind } from "../api/history";

export function HistoryFilters({ kind, value, onChange, symbols }: {
  kind: HistoryKind; value: Filters; onChange: (next: Filters) => void; symbols: readonly TradingSymbol[];
}) {
  const update = (field: keyof Filters, next: string) => onChange({ ...value, [field]: next });
  return <div className="history-filters" aria-label="내역 필터">
    <label>종목<select value={value.symbolId} onChange={event => update("symbolId", event.target.value)}><option value="">전체</option>{symbols.map(symbol => <option key={symbol.id} value={symbol.id}>{symbol.displaySymbol}</option>)}</select></label>
    <label>방향<select value={value.side} onChange={event => update("side", event.target.value)}><option value="">전체</option><option value="LONG">Long</option><option value="SHORT">Short</option></select></label>
    {kind !== "closed" && <label>동작<select value={value.action} onChange={event => update("action", event.target.value)}><option value="">전체</option><option value="OPEN">Open</option><option value="CLOSE">Close</option><option value="LIQUIDATE">강제청산</option></select></label>}
    {kind !== "closed" && <label>유형<select value={value.type} onChange={event => update("type", event.target.value)}><option value="">전체</option><option value="MARKET">Market</option><option value="LIMIT">Limit</option></select></label>}
    {kind !== "fills" && <label>상태<select value={value.status} onChange={event => update("status", event.target.value)}><option value="">전체</option>{(kind === "closed" ? ["CLOSED", "LIQUIDATED"] : ["PENDING", "FILLED", "CANCELED", "REJECTED"]).map(status => <option key={status} value={status}>{status}</option>)}</select></label>}
    {kind !== "orders" && <><label>시작 시각 · 현지<input type="datetime-local" value={value.from} onChange={event => update("from", event.target.value)} /></label><label>종료 전 · 현지<input type="datetime-local" value={value.before} onChange={event => update("before", event.target.value)} /></label></>}
    <button type="button" className="account-refresh" onClick={() => onChange({ ...emptyHistoryFilters })}>초기화</button>
    {!validHistoryDates(kind, value) && <p role="alert">종료 시각을 시작 시각보다 뒤로 설정해 주세요.</p>}
  </div>;
}

export const emptyHistoryFilters: Filters = { symbolId: "", side: "", action: "", type: "", status: "", from: "", before: "" };
