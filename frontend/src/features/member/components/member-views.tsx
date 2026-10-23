import Link from "next/link";
import type { ReactNode, FormEventHandler } from "react";
import { NicknameCheck } from "./nickname-check";
import { NicknameInput } from "./nickname-input";
export { SignupForm } from "./signup-form";

export function MemberShell({ title, children }: { title: string; children: ReactNode }) {
  return <main className="member-shell"><header><Link href="/trading" className="member-logo">요기망치</Link><nav aria-label="회원 메뉴"><Link href="/trading">모의투자</Link><Link href="/account">내 계정</Link></nav></header><section className="member-card"><h1>{title}</h1>{children}</section></main>;
}
export function MemberLoginView({ google, kakao }: { google: string; kakao: string }) {
  return <div className="member-fields"><p>Google 또는 Kakao 계정으로 로그인하세요.</p><a className="member-primary" href={google}>Google로 계속하기</a><a className="member-secondary" href={kakao}>Kakao로 계속하기</a><p className="member-note">Guest 모의투자 기록은 회원 계정에 자동으로 합쳐지지 않습니다.</p><Link href="/trading">게스트 모의투자로 돌아가기</Link></div>;
}
export function ProfileEditForm({ nickname, message, pending, onSubmit }: { nickname: string; message: string; pending: boolean; onSubmit: FormEventHandler<HTMLFormElement> }) {
  return <form className="member-fields" onSubmit={onSubmit}><fieldset disabled={pending}>
    <label>닉네임<NicknameInput initialValue={nickname} /><small>최대 8자 · 공백·특수문자 제외</small></label>
    <NicknameCheck />
    <label>소개<textarea name="profileMessage" defaultValue={message} maxLength={255} rows={4} /><small>최대 255자 · 비워서 저장하면 소개를 지웁니다.</small></label>
    <button className="member-primary" type="submit">{pending ? "저장 중…" : "프로필 저장"}</button>
  </fieldset></form>;
}
