"use client";

import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useGuestSession } from "./trading-data-provider";
import { tradingKeys } from "../api/query-keys";
import { parseRound, parseRoundLedger, parseRoundSummary, roundPage, type RoundLedgerKind, type RoundLedgerRow } from "../api/member-rounds";
import { formatDecimal, formatQuantity } from "../api/account";
import { TradingApiError } from "../api/client";
import { mutationMessage, uncertainMutation } from "../api/mutation-request";
import { RestartConfirmation, SimulationSection } from "./member-simulation-views";
import { reportAdmissionRejection } from "../api/admission-rejection";
import { useTradingAdmission } from "../api/recovery";
import { SymbolPerformance } from "./symbol-performance";
import { useMember } from "../../member/components/member-provider";

function useCurrentRound() {
  const { session, snapshot } = useGuestSession();
  return useQuery({ queryKey: [...tradingKeys.account(snapshot), "member-current-round"], enabled: snapshot.mode === "member" && snapshot.phase === "ready" && !snapshot.retrying,
    queryFn: async ({ signal }) => parseRoundSummary(await session.read("account/rounds/current", snapshot, signal), snapshot.accountId!), refetchInterval: query => query.state.status === "error" ? false : 5000 });
}
export function MemberRoundMonitor() {
  const { session, snapshot } = useGuestSession(), current = useCurrentRound();
  useEffect(() => { if (!current.isError && current.data) session.observeMemberRound(current.data.round.roundId, snapshot); }, [session, snapshot, current.data, current.isError]);
  return null;
}
const labels: Record<string, string> = { id: "ID", tradingSymbolId: "종목 ID", side: "방향", status: "상태", type: "유형", action: "주문", quantity: "수량", filledPrice: "체결가", limitPrice: "지정가", createdAt: "접수 시각", executedAt: "체결 시각", price: "가격", realizedPnl: "실현손익", fee: "수수료", settlementAdjustment: "정산 조정", orderId: "주문 ID", entryPrice: "진입가", exitPrice: "종료가", margin: "증거금", openedAt: "시작 시각", closedAt: "종료 시각", closeReason: "종료 사유", retiredQuantity: "관리상 종료 수량", retiredMargin: "해제 증거금" };
const fields: Record<RoundLedgerKind, string[]> = {
  orders: ["id", "tradingSymbolId", "type", "action", "side", "status", "quantity", "filledPrice", "limitPrice", "createdAt"],
  fills: ["id", "orderId", "quantity", "price", "realizedPnl", "fee", "settlementAdjustment", "executedAt"],
  positions: ["id", "tradingSymbolId", "side", "status", "quantity", "entryPrice", "exitPrice", "realizedPnl", "margin", "retiredQuantity", "retiredMargin", "closeReason", "openedAt", "closedAt"],
};
function cell(item: RoundLedgerRow, field: string) {
  const value = item[field]; if (value === null || value === undefined) return "—";
  if (field.endsWith("At")) return new Date(String(value)).toLocaleString("ko-KR");
  if (field === "closeReason") return value === "MEMBER_RESTART" ? "관리상 종료 · 다시시작" : value === "MEMBER_WITHDRAWAL" ? "관리상 종료 · 탈퇴" : "서버 종료";
  if (["realizedPnl", "fee", "margin", "retiredMargin", "settlementAdjustment"].includes(field)) return formatDecimal(String(value));
  if (["quantity", "retiredQuantity", "price", "entryPrice", "exitPrice", "filledPrice", "limitPrice"].includes(field)) return formatQuantity(String(value));
  return String(value);
}
function RoundLedger({ roundId, kind }: { roundId: number; kind: RoundLedgerKind }) {
  const { session, snapshot } = useGuestSession();
  const query = useInfiniteQuery({ queryKey: [...tradingKeys.account(snapshot), "member-round", roundId, kind], initialPageParam: undefined as number | undefined,
    enabled: snapshot.mode === "member" && snapshot.phase === "ready" && !snapshot.retrying,
    queryFn: async ({ signal, pageParam }) => parseRoundLedger(await session.read(`account/rounds/${roundId}/${kind}?limit=20${pageParam ? `&cursorId=${pageParam}` : ""}`, snapshot, signal), kind, roundId, pageParam),
    getNextPageParam: page => page.nextCursorId ?? undefined });
  const rows = query.isError && !query.isFetchNextPageError ? undefined : query.data?.pages.flatMap(page => page.content);
  return <>{query.isPending && <p role="status">회차 기록을 불러오는 중입니다.</p>}{query.isError && <p role="alert" className="member-message">회차 기록을 확인하지 못했습니다. <button className="account-refresh" onClick={() => void query.refetch()}>다시 조회</button></p>}
    {rows?.length === 0 && <p className="member-message">이 회차에 해당 기록이 없습니다.</p>}{rows && rows.length > 0 && <div className="member-round-ledger" tabIndex={0} aria-label="회차별 읽기 전용 기록"><table><thead><tr>{fields[kind].map(field => <th key={field}>{labels[field]}</th>)}</tr></thead><tbody>{rows.map(item => <tr key={item.id}>{fields[kind].map(field => <td key={field}>{cell(item, field)}</td>)}</tr>)}</tbody></table></div>}
    {query.hasNextPage && <button className="member-secondary" disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>{query.isFetching ? "불러오는 중…" : "내역 더 보기"}</button>}</>;
}
export function MemberSimulation() {
  const { snapshot } = useMember();
  return <MemberSimulationContent key={snapshot.memberId ?? "anonymous"} />;
}
function MemberSimulationContent() {
  const admission = useTradingAdmission(), client = useQueryClient();
  const { session, snapshot } = useGuestSession(), current = useCurrentRound();
  const [selected, setSelected] = useState<number | null>(null), [kind, setKind] = useState<RoundLedgerKind>("orders");
  const [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
  const [intent, setIntent] = useState<{ accountId: number; key: string } | null>(null), [acknowledged, setAcknowledged] = useState(false), [limitedAt, setLimitedAt] = useState<string | null>(null);
  const active = useRef(false), dialog = useRef<HTMLDialogElement>(null);
  const enabled = snapshot.mode === "member" && snapshot.phase === "ready" && !snapshot.retrying;
  const canRestart = admission.trade && enabled && !current.isError && !current.isFetching && current.data?.round.roundId === snapshot.roundId && !!current.data?.restartAvailable;
  const rounds = useInfiniteQuery({ queryKey: [...tradingKeys.account(snapshot), "member-round-list"], enabled, initialPageParam: undefined as number | undefined,
    queryFn: async ({ signal, pageParam }) => roundPage(await session.read(`account/rounds?limit=20${pageParam ? `&cursorId=${pageParam}` : ""}`, snapshot, signal), parseRound, round => round.roundId, pageParam), getNextPageParam: page => page.nextCursorId ?? undefined });
  const selectedId = selected ?? current.data?.round.roundId;
  const detail = useQuery({ queryKey: [...tradingKeys.account(snapshot), "member-round-detail", selectedId], enabled: enabled && !!selectedId,
    queryFn: async ({ signal }) => parseRoundSummary(await session.read(`account/rounds/${selectedId}`, snapshot, signal), snapshot.accountId!, selectedId) });
  async function restart() {
    if (!admission.trade || active.current || !acknowledged || !intent && !canRestart) return;
    active.current = true; setPending(true); setError(null);
    const request = intent ?? { accountId: snapshot.accountId!, key: crypto.randomUUID() };
    try {
      const result = await session.restartMember(snapshot, request.key);
      setIntent(null); setSelected(null); setLimitedAt(result.nextAvailableAt); dialog.current?.close();
      setMessage(`요청은 ${result.roundNumber}회차 생성으로 처리되었습니다. 미체결 ${result.canceledOrderCount}건 취소 · 포지션 ${result.closedPositionCount}건 관리상 종료. 현재 회차와 잔액은 서버 조회값으로 표시합니다.`);
    } catch (error) {
      reportAdmissionRejection(client,snapshot,error);
      const uncertain = uncertainMutation(error);
      setIntent(uncertain ? request : null);
      if (error instanceof TradingApiError && error.nextAvailableAt) setLimitedAt(error.nextAvailableAt);
      setError(uncertain ? "결과가 불확실합니다. 새 요청을 만들지 않고 같은 요청의 결과를 확인해 주세요." : error instanceof TradingApiError && error.status === 429 ? "직전 성공한 다시시작부터 24시간이 지나야 합니다. 서버가 제공한 가능 시각을 확인해 주세요." : mutationMessage(error));
    } finally { active.current = false; setPending(false); }
  }
  const summary = !detail.isError && enabled ? detail.data : undefined;
  const nextAt = current.data?.nextAvailableAt ?? limitedAt;
  return <SimulationSection>
    {snapshot.mode !== "member" ? <p role="status">회원 동의와 금융 계정 상태를 확인하는 중입니다.</p> : snapshot.phase !== "ready" && !snapshot.retrying ? <><p role="status">{snapshot.phase === "anonymous" ? "회원 Trading 계정이 아직 준비되지 않았습니다. 신규 계정의 1회차 시작 자금은 서버가 10,000 USDT로 지급하며 기존 계정 잔액은 자동 변경하지 않습니다." : "회원 금융 계정을 확인하지 못했습니다. 임시 잔액은 표시하지 않습니다."}</p><button className="member-secondary" disabled={pending || !!intent || snapshot.phase === "loading" || snapshot.phase === "creating"} onClick={() => { void (snapshot.phase === "anonymous" ? session.createMember() : session.restore()); }}>회원 계정 준비·잔액 다시 확인</button></> : null}
    {enabled && <><p className="member-note">서버 기준 현재 회차 · {current.data?.round.roundNumber ?? "확인 중"}회차. 과거 회차는 읽기 전용이며 거래 화면은 현재 회차만 사용합니다.</p>
      {(current.isError || rounds.isError || detail.isError) && <p className="member-message" role="alert">회차 정보를 확인하지 못했습니다. <button className="account-refresh" onClick={() => { void current.refetch(); void rounds.refetch(); void detail.refetch(); }}>다시 조회</button></p>}
      <label className="member-round-select">모의투자 회차<select aria-label="모의투자 회차 선택" value={selectedId ?? ""} disabled={!rounds.data || rounds.isError} onChange={event => setSelected(Number(event.currentTarget.value))}>
        {!rounds.data && <option value="">회차 확인 중</option>}{summary && !rounds.data?.pages.some(page => page.content.some(round => round.roundId === summary.round.roundId)) && <option value={summary.round.roundId}>{summary.round.roundNumber}회차 · {summary.round.currentRound ? "진행 중" : "종료 · 읽기 전용"}</option>}{rounds.data?.pages.flatMap(page => page.content).map(round => <option key={round.roundId} value={round.roundId}>{round.roundNumber}회차 · {round.currentRound ? "진행 중" : "종료 · 읽기 전용"}</option>)}</select></label>
      {rounds.hasNextPage && <button className="member-secondary" disabled={rounds.isFetching} onClick={() => void rounds.fetchNextPage()}>이전 회차 더 불러오기</button>}
      {selectedId && <SymbolPerformance roundId={selectedId} />}
      {summary && <><dl className="member-round-summary">{[
        ["상태", summary.round.currentRound ? "진행 중" : "종료 · 읽기 전용"], ["시작 가상 자금", summary.round.initialBalance === null ? "기존 회차 · 초기 자금 확인되지 않음" : `${formatDecimal(summary.round.initialBalance)} USDT`],
        ["시작 시각", new Date(summary.round.startedAt).toLocaleString("ko-KR")], ["종료 시각", summary.round.endedAt ? new Date(summary.round.endedAt).toLocaleString("ko-KR") : "—"],
        [summary.round.currentRound ? "현재 Wallet 잔액" : "종료 Wallet 잔액", `${formatDecimal(summary.currentAccount?.wallet.balance ?? summary.round.finalWallet?.balance)} USDT`],
        ["사용 증거금", `${formatDecimal(summary.currentAccount?.wallet.usedMargin ?? summary.round.finalWallet?.usedMargin)} USDT`], ["예약 증거금", `${formatDecimal(summary.currentAccount?.wallet.reservedMargin ?? summary.round.finalWallet?.reservedMargin)} USDT`],
        ["회차 실현손익", `${formatDecimal(summary.realizedPnl)} USDT`], ["회차 수수료", `${formatDecimal(summary.feesPaid)} USDT`], ["정산 조정", `${formatDecimal(summary.settlementAdjustment)} USDT`],
      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <div className="member-actions" role="group" aria-label="회차 거래 기록 종류">{(["orders", "fills", "positions"] as const).map(value => <button key={value} className="member-secondary" aria-pressed={kind === value} onClick={() => setKind(value)}>{value === "orders" ? "주문 내역" : value === "fills" ? "실제 체결 내역" : "포지션 생애주기"}</button>)}</div>
        <RoundLedger key={`${snapshot.generation}:${selectedId}:${kind}`} roundId={summary.round.roundId} kind={kind} />
      </>}
    </>}
    {snapshot.mode === "member" && <><p className="member-note">다음 다시시작 가능 시각: {nextAt ? new Date(nextAt).toLocaleString("ko-KR") : !current.isError && current.data ? "서버에서 제한 없음으로 확인" : "서버 확인 필요"}. 최종 허용 여부는 서버가 판단합니다.</p><button className="member-primary" disabled={pending || snapshot.retrying || !intent && !canRestart} onClick={() => { setAcknowledged(false); dialog.current?.showModal(); }}>모의투자 다시시작하기</button><p className="member-note"><Link href="/trading">현재 회차 거래 화면으로 이동</Link></p></>}
    {message && <p role="status" className="member-message">{message}</p>}
    <dialog ref={dialog} className="position-close-dialog member-withdrawal-dialog" aria-labelledby="member-restart-title" onCancel={event => { if (pending) event.preventDefault(); }}>
      <RestartConfirmation acknowledged={acknowledged} pending={pending} uncertain={!!intent} error={error} blocked={!canRestart ? "서버가 다시시작 가능 여부를 확인하기 전에는 새로운 요청을 보낼 수 없습니다." : undefined} onAcknowledge={setAcknowledged} onExecute={() => void restart()} onClose={() => dialog.current?.close()} />
    </dialog>
  </SimulationSection>;
}
