"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGuestSession } from "./trading-data-provider";
import { tradingKeys } from "../api/query-keys";
import { parsePerformance, performancePath, type PerformanceFilters } from "../api/performance";
import { formatDecimal } from "../api/account";

export function SymbolPerformance({ roundId }: { roundId?: number }) {
  const { session, snapshot } = useGuestSession();
  const [from, setFrom] = useState(""), [before, setBefore] = useState("");
  const [period, setPeriod] = useState<Pick<PerformanceFilters, "from" | "before">>({});
  const valid = (!from || Number.isFinite(Date.parse(from))) && (!before || Number.isFinite(Date.parse(before)))
    && (!from || !before || Date.parse(from) < Date.parse(before));
  const filters: PerformanceFilters = { ...period, ...(roundId ? { roundId } : {}) };
  const query = useQuery({ queryKey: [...tradingKeys.account(snapshot), "symbol-performance", filters],
    enabled: snapshot.phase === "ready" && !snapshot.retrying, refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => parsePerformance(await session.read(performancePath(filters), snapshot, signal), filters) });
  const data = snapshot.phase === "ready" && !query.isError ? query.data : undefined;
  const totals = data?.totals;
  return <section className="wallet-overview" aria-label="종목별 확정 성과"><h3>종목별 확정 성과{roundId ? ` · 회차 #${roundId}` : " · 전체 회차"}</h3>
    <form className="history-filters" onSubmit={event => { event.preventDefault(); if (valid) setPeriod({ ...(from ? { from: new Date(from).toISOString() } : {}), ...(before ? { before: new Date(before).toISOString() } : {}) }); }}>
      <label>시작 · 로컬 시각<input type="datetime-local" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label>종료 · 로컬 시각<input type="datetime-local" value={before} onChange={event => setBefore(event.target.value)} /></label>
      <button className="account-refresh" disabled={!valid || query.isFetching}>기간 적용</button>
      <button className="account-refresh" type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>새로고침</button>
    </form>
    {!valid && <p role="alert">종료 시각은 시작 시각보다 뒤여야 합니다.</p>}
    {query.isPending && <p role="status">서버 성과를 조회 중입니다.</p>}
    {query.isError && <p role="alert">성과를 조회하지 못했습니다. 새로고침으로 다시 시도해 주세요.</p>}
    {data && <><p>서버 전체 범위 집계 · LONG/SHORT 합산 · 실제 체결 {totals!.fillCount}건</p>
      <p>조회 기간: {new Date(data.scope.fromInclusive).toLocaleString("ko-KR")} 이상 ~ {new Date(data.scope.beforeExclusive).toLocaleString("ko-KR")} 미만 · 기준 {new Date(data.capturedAt).toLocaleString("ko-KR")}</p>
      <dl>{[["체결 거래대금", totals!.turnover], ["Gross PnL · 수수료 전", totals!.grossRealizedPnl], ["수수료", totals!.fees], ["순손익 · Gross − 수수료", totals!.economicTradingPnl], ["정산 조정 · 투자 수익 제외", totals!.settlementAdjustment], ["현금 변동 · 순손익 + 정산 조정", totals!.cashTradingPnl], ["재시작 자금 조정 · 투자 수익 제외", data.capitalAdjustment]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{formatDecimal(value)} USDT</dd></div>)}</dl>
      <p>거래대금은 실제 진입·청산·강제청산 체결의 가격×수량을 각각 한 번 집계합니다. 미체결·취소·관리상 종료와 재시작 자금은 거래량에 포함하지 않습니다.</p>
      {data.roundReturn && <p>회차 수익률: {formatDecimal(data.roundReturn.returnPercent)}% · {data.roundReturn.status === "LEGACY_UNVERIFIED" ? "초기 자금 미확인" : data.roundReturn.status === "PRICE_UNAVAILABLE" ? "현재 시세 평가 불가" : data.roundReturn.status === "FINAL" ? "종료 확정" : "현재 평가 기준"}. 초기 자금 {formatDecimal(data.roundReturn.initialCapital)} USDT 대비 (평가 자산 − 초기 자금 − 자금 조정) ÷ 초기 자금. 기준 {new Date(data.roundReturn.valuedAt).toLocaleString("ko-KR")}</p>}
      <div className="member-round-ledger" tabIndex={0} aria-label="종목별 성과 표"><table><thead><tr>{["종목", "체결 거래대금", "거래대금 비중", "Gross PnL", "수수료", "순손익", "정산 조정", "현금 변동", "현재 미실현손익"].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
        {data.symbols.map(item => <tr key={item.tradingSymbolId}><td>{item.symbol}/USDT</td><td>{formatDecimal(item.turnover)}</td><td>{formatDecimal(item.turnoverSharePercent)}%</td><td>{formatDecimal(item.grossRealizedPnl)}</td><td>{formatDecimal(item.fees)}</td><td>{formatDecimal(item.economicTradingPnl)}</td><td>{formatDecimal(item.settlementAdjustment)}</td><td>{formatDecimal(item.cashTradingPnl)}</td><td>{formatDecimal(item.currentUnrealizedPnl)}<small> · {item.valuationStatus === "NO_OPEN_EXPOSURE" ? "보유 없음" : item.valuationStatus === "FRESH" ? "현재 평가" : "시세 평가 불가"} · {new Date(item.valuedAt).toLocaleString("ko-KR")}</small></td></tr>)}
      </tbody></table></div>
      {data.symbols.length === 0 && <p>선택 범위에 체결 성과나 현재 보유 포지션이 없습니다.</p>}
      <p>현재 미실현손익은 과거 조회 기간과 별개인 현재 OPEN 포지션 평가입니다. 종목 수익률이나 포지션 ROE 평균은 표시하지 않습니다.</p>
    </>}
  </section>;
}
