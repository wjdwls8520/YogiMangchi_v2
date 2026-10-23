import { PolicyContent, policyTitle, type PolicyDocument, type PolicyType } from "./policy-content";

export function PolicyConsentFields({ versions, accepted, disabled, onChange, onOpen }: {
  versions: Record<PolicyType, string>; accepted: Record<PolicyType, boolean>; disabled: boolean;
  onChange: (type: PolicyType, value: boolean) => void; onOpen: (type: PolicyType) => void;
}) {
  return <div className="policy-consent-fields">{(["TERMS", "PRIVACY"] as const).map(type => <div key={type}>
    <label className="member-check"><input name={type === "TERMS" ? "termAgree" : "privateAgree"} type="checkbox" checked={accepted[type]} disabled={disabled} onChange={event => onChange(type, event.currentTarget.checked)} /><span>{type === "TERMS" ? "이용약관 동의" : "개인정보 수집·이용 동의 및 개인정보처리방침 확인"} (필수)</span></label>
    <button type="button" className="account-refresh" disabled={disabled} onClick={() => onOpen(type)}>내용 보기 · {policyTitle(type)}</button><p className="member-note">{versions[type]}</p>
  </div>)}<input type="hidden" name="termsVersion" value={versions.TERMS} /><input type="hidden" name="privacyVersion" value={versions.PRIVACY} /></div>;
}
export function PolicyDialogContent({ document, accepted, onAccept, onRevoke, onClose }: {
  document: PolicyDocument; accepted: boolean; onAccept: () => void; onRevoke: () => void; onClose: () => void;
}) {
  return <><header className="policy-dialog-header"><h2 id="policy-dialog-title">{policyTitle(document.type)}</h2><button className="member-secondary" type="button" onClick={onClose}>동의하지 않고 닫기</button></header>
    <PolicyContent type={document.type} document={document} /><div className="policy-dialog-actions"><p role="status">{accepted ? "현재 이 버전에 동의한 상태입니다." : "현재 이 버전에 동의하지 않았습니다."}</p><button type="button" className="member-secondary" onClick={onRevoke}>이 화면의 동의 해제</button><button type="button" className="member-primary" onClick={onAccept}>이 버전에 동의하고 닫기</button></div></>;
}
