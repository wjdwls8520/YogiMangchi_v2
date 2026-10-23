"use client";

import { useState, type FormEventHandler } from "react";
import { usePolicies, PolicyConsentControl } from "./policy-controls";
import type { ConsentSelection } from "../api/policies";
import { NicknameInput } from "./nickname-input";
import { NicknameCheck } from "./nickname-check";

export function SignupForm({ onSubmit, pending }: { onSubmit: FormEventHandler<HTMLFormElement>; pending: boolean }) {
  const policies = usePolicies(), [selection, setSelection] = useState<ConsentSelection>({});
  return <form className="member-fields" onSubmit={onSubmit}><fieldset disabled={pending}>
    <label>닉네임<NicknameInput /><small>최대 8자 · 공백·특수문자 제외</small></label><NicknameCheck />
    <label>소개<textarea name="profileMessage" maxLength={255} rows={3} /><small>선택 · 최대 255자</small></label>
    {policies.isPending && <p role="status">필수 동의 문서를 확인하는 중입니다.</p>}
    {policies.isError && <p role="alert" className="member-message">동의 원문과 버전을 확인하지 못해 가입할 수 없습니다. <button type="button" className="account-refresh" onClick={() => void policies.refetch()}>다시 조회</button></p>}
    {!policies.isError && policies.data && <PolicyConsentControl bundle={policies.data} selection={selection} onChange={setSelection} pending={pending} />}
    <button type="submit" className="member-primary" disabled={pending || !policies.data || policies.isError}>{pending ? "가입 처리 중…" : "동의하고 가입하기"}</button>
  </fieldset></form>;
}
