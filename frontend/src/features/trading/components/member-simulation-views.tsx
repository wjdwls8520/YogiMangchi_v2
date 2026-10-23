import type { ReactNode } from "react";

export function SimulationSection({ children }: { children: ReactNode }) {
  return <section className="member-simulation" aria-labelledby="member-simulation-title"><h2 id="member-simulation-title">내 모의투자 · 회차별 포트폴리오</h2>{children}</section>;
}
export function RestartConfirmation({ acknowledged, pending, blocked, error, uncertain, onAcknowledge, onExecute, onClose }: {
  acknowledged: boolean; pending: boolean; blocked?: string; error?: string | null; uncertain: boolean;
  onAcknowledge: (value: boolean) => void; onExecute: () => void; onClose: () => void;
}) {
  return <><h2 id="member-restart-title">모의투자 다시시작하기</h2><ul className="member-withdrawal-policy">
    <li>현재 회차를 종료하고 모든 미체결 주문을 취소합니다. 열린 포지션은 관리상 종료하며 새로운 체결·청산·손익·수수료는 만들지 않습니다.</li>
    <li>기존 회차의 자산 상태와 거래 내역은 과거 기록으로 남습니다. 새 회차는 10,000 USDT로 시작합니다.</li>
    <li>같은 회원 ID를 유지하며 Guest 자금과 합치지 않습니다. 성공한 시점부터 다음 24시간 동안 다시시작할 수 없습니다.</li>
    <li>이 작업은 취소하거나 이전 회차의 거래를 이어갈 수 없습니다.</li>
  </ul><label className="member-check"><input type="checkbox" checked={acknowledged} disabled={pending} onChange={event => onAcknowledge(event.currentTarget.checked)} /><span>안내 내용을 확인했으며 새 회차로 다시 시작합니다.</span></label>
    {blocked && <p className="member-message" role="status">{blocked}</p>}{error && <p className="member-message" role="alert">{error}</p>}
    <div className="member-actions"><button className="member-secondary" disabled={pending} onClick={onClose}>닫기</button><button className="member-primary" disabled={pending || !acknowledged || !!blocked && !uncertain} onClick={onExecute}>{pending ? "처리 중…" : uncertain ? "같은 요청 결과 확인" : "새 회차 시작 확인"}</button></div></>;
}
