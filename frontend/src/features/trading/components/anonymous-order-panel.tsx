import Link from "next/link";
import { OrderChoices, OrderInput } from "./order-controls";
import type { MemberSnapshot } from "../../member/api/session";
import type { SessionSnapshot } from "../api/guest-session";

export function isAnonymousOrderEntry(member: MemberSnapshot, trading: SessionSnapshot) {
  return member.phase === "anonymous" && !member.recovery && !trading.mode
    && (trading.phase === "anonymous" || trading.phase === "error");
}

// Presentation only: anonymous entry must never mount account/quote/leverage hooks.
export function AnonymousOrderPanel({ onGuest, storageError = false }: { onGuest: () => void; storageError?: boolean }) {
  return <section className="order-panel trading-section order-entry" aria-labelledby="order-entry-heading">
    <div className="order-entry-content" inert aria-hidden="true">
      <header className="section-heading"><h2 className="section-title" id="order-heading">주문</h2><span className="preview-label">모의투자</span></header>
      <div className="order-panel-body">
        <OrderChoices legend="주문 목적" name="entry-intent" selected="open" disabled choices={[{value:"open",label:"진입 · Open"},{value:"close",label:"청산 · Close"}]} />
        <dl className="order-wallet"><div><dt>사용 가능 자산</dt><dd>— USDT</dd></div></dl>
        <OrderChoices legend="주문 유형" name="entry-type" selected="MARKET" disabled choices={[{value:"MARKET",label:"시장가"},{value:"LIMIT",label:"지정가"}]} />
        <OrderChoices legend="포지션 방향" name="entry-side" selected="LONG" disabled choices={[{value:"LONG",label:"↗ Long"},{value:"SHORT",label:"↘ Short"}]} />
        <div className="order-leverage"><label className="field-label" htmlFor="entry-leverage">레버리지 · Isolated</label><select id="entry-leverage" className="order-leverage-input" disabled><option>로그인 후 확인</option></select></div>
        <OrderInput id="entry-quantity" label="주문 수량" unit="" placeholder="수량 입력" disabled />
        <div className="order-ratio"><label htmlFor="entry-ratio" className="field-label">참고 자산 비율</label><input id="entry-ratio" type="range" min="0" max="100" value="0" disabled readOnly /></div>
        <dl className="order-estimates"><div><dt>예상 필요 자산</dt><dd>— USDT</dd></div></dl>
        <div className="order-actions"><button type="button" data-side="LONG" disabled>↗ Long</button><button type="button" data-side="SHORT" disabled>↘ Short</button></div>
      </div>
    </div>
    <div className="order-entry-overlay">
      <div className="order-entry-card">
        <h2 id="order-entry-heading">로그인 이후 이용 가능</h2>
        <p>로그인하거나 게스트로 참여해 모의투자를 시작하세요.</p>
        <div className="order-entry-actions"><Link className="guest-start-button" href="/login">로그인</Link><button className="guest-cancel" type="button" onClick={onGuest}>게스트 로그인</button></div>
        {storageError && <p role="alert">게스트 기록을 확인하지 못했습니다. 브라우저 저장소 사용이 허용되어 있는지 확인해 주세요.</p>}
      </div>
    </div>
  </section>;
}
