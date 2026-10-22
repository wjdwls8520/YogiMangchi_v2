import Link from "next/link";
import type { ReactNode, FormEventHandler } from "react";
import { NicknameCheck } from "./nickname-check";
import { NicknameInput } from "./nickname-input";

export function MemberShell({ title, children }: { title: string; children: ReactNode }) {
  return <main className="member-shell"><header><Link href="/trading" className="member-logo">요기망치</Link><nav aria-label="회원 메뉴"><Link href="/trading">모의투자</Link><Link href="/account">내 계정</Link></nav></header><section className="member-card"><h1>{title}</h1>{children}</section></main>;
}
export function MemberLoginView({ google, kakao }: { google: string; kakao: string }) {
  return <div className="member-fields"><p>Google 또는 Kakao 계정으로 로그인하세요.</p><a className="member-primary" href={google}>Google로 계속하기</a><a className="member-secondary" href={kakao}>Kakao로 계속하기</a><p className="member-note">Guest 모의투자 기록은 회원 계정에 자동으로 합쳐지지 않습니다.</p><Link href="/trading">게스트 모의투자로 돌아가기</Link></div>;
}
export function SignupForm({ onSubmit, pending, terms, privacy }: { onSubmit: FormEventHandler<HTMLFormElement>; pending: boolean; terms: string | null; privacy: string | null }) {
  return <form className="member-fields" onSubmit={onSubmit}><fieldset disabled={pending}>
    <label>닉네임<NicknameInput /><small>최대 8자 · 공백·특수문자 제외</small></label>
    <NicknameCheck />
    <label>소개<textarea name="profileMessage" maxLength={255} rows={3} /><small>선택 · 최대 255자</small></label>
    <label className="member-check"><input name="termAgree" type="checkbox" required />이용약관 동의 (필수){terms && <a href={terms} target="_blank" rel="noopener noreferrer">내용 보기</a>}</label>
    <label className="member-check"><input name="privateAgree" type="checkbox" required />개인정보처리방침 동의 (필수){privacy && <a href={privacy} target="_blank" rel="noopener noreferrer">내용 보기</a>}</label>
    {(!terms || !privacy) && <p role="status" className="member-note">동의 문서 링크는 준비 중입니다.</p>}
    <button type="submit" className="member-primary" disabled={pending}>{pending ? "가입 처리 중…" : "동의하고 가입하기"}</button>
  </fieldset></form>;
}
export function ProfileEditForm({ nickname, message, pending, onSubmit }: { nickname: string; message: string; pending: boolean; onSubmit: FormEventHandler<HTMLFormElement> }) {
  return <form className="member-fields" onSubmit={onSubmit}><fieldset disabled={pending}>
    <label>닉네임<NicknameInput initialValue={nickname} /><small>최대 8자 · 공백·특수문자 제외</small></label>
    <NicknameCheck />
    <label>소개<textarea name="profileMessage" defaultValue={message} maxLength={255} rows={4} /><small>최대 255자 · 비워서 저장하면 소개를 지웁니다.</small></label>
    <button className="member-primary" type="submit">{pending ? "저장 중…" : "프로필 저장"}</button>
  </fieldset></form>;
}
