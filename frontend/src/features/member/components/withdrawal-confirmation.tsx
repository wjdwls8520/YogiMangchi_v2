import type { FormEventHandler } from "react";

export function WithdrawalConfirmation({ onSubmit, onCancel, acknowledged = false, confirmation = "", onAcknowledge, onConfirmation, ready = false, pending = false, error }: {
  onSubmit: FormEventHandler<HTMLFormElement>; onCancel: () => void; acknowledged?: boolean; confirmation?: string;
  onAcknowledge?: (value: boolean) => void; onConfirmation?: (value: string) => void; ready?: boolean; pending?: boolean; error?: string | null;
}) {
  return <>
    <h2 id="member-withdraw-title">탈퇴 전 확인해 주세요</h2>
    <p id="member-withdraw-notice">아래는 새로 확정된 탈퇴 정책입니다. 내용을 모두 확인한 뒤 직접 확인 문구를 입력해야 합니다.</p>
    <ul className="member-withdrawal-policy">
      <li>탈퇴한 계정은 복구할 수 없으며, 회원정보와 Google·Kakao 로그인 연결은 제거됩니다.</li>
      <li>같은 소셜 계정으로 다시 가입해도 새로운 회원으로 가입합니다. 기존 모의투자 자산과 거래 이력은 복구되거나 새 계정으로 이전되지 않습니다.</li>
      <li>모든 미체결 주문을 취소하고 열린 포지션은 관리상 종료합니다. 시장가 청산이나 강제청산으로 처리하지 않으며, 새로운 체결·손익·수수료를 만들지 않습니다.</li>
      <li>작성한 게시글·댓글·대댓글의 내용은 남습니다. 작성자 이름과 식별 가능한 멘션 대상은 ‘탈퇴한회원’으로 표시되며, 탈퇴 회원의 공개 프로필과 상호작용은 차단됩니다.</li>
      <li>회원 ID와 탈퇴 상태·시각, 필요한 과거 거래 이력은 서버 보존 정책에 따라 유지됩니다. 개인정보 보존 예외의 근거와 기간은 별도로 안내해야 합니다.</li>
      <li>Guest 기록은 회원 기록과 별개로 유지됩니다.</li>
    </ul>
    {!ready && <p role="status" id="member-withdraw-blocked" className="member-message">최근 동일 소셜 계정으로 본인 확인한 뒤 요청할 수 있습니다. 서버의 확인 문구 검증과 즉시 거래 차단을 포함한 처리를 확인합니다.</p>}
    {error && <p role="alert" className="member-message">{error}</p>}
    <form className="member-fields" onSubmit={onSubmit}>
      <label className="member-check"><input name="acknowledged" type="checkbox" required checked={acknowledged} disabled={pending} onChange={event => onAcknowledge?.(event.currentTarget.checked)} /><span>복구 불가능성과 개인정보·게시글·거래 이력 처리 내용을 모두 확인했습니다.</span></label>
      <label>확인 문구<input name="confirmation" autoComplete="off" required pattern="탈퇴합니다" placeholder="탈퇴합니다" aria-describedby="member-withdraw-signature" value={confirmation} disabled={pending} onChange={event => onConfirmation?.(event.currentTarget.value)} /></label>
      <small id="member-withdraw-signature">‘탈퇴합니다’를 정확하게 입력해 주세요. 이는 탈퇴 의사를 확인하는 절차입니다.</small>
      <div className="member-actions"><button type="button" className="member-secondary" disabled={pending} onClick={onCancel}>닫기</button><button type="submit" className="member-primary" disabled={!ready || !acknowledged || confirmation !== "탈퇴합니다" || pending}>{pending ? "탈퇴 요청 중…" : ready ? "탈퇴 요청" : "본인 확인 필요"}</button></div>
    </form>
  </>;
}
