import Link from "next/link";
import drafts from "../policy-drafts.json";
import type { PolicyType, PolicyDocument } from "../api/policies";
export type { PolicyType, PolicyDocument } from "../api/policies";

export const policyPublication = {
  operator: "[추후 운영 주체명이 들어갈 곳]",
  contact: "[추후 문의 연락처가 들어갈 곳]",
  privacyOfficer: "[추후 개인정보 보호 담당자가 들어갈 곳]",
  effectiveDate: "[추후 시행일이 들어갈 곳]",
  review: "초안 · 정식 게시 전 법률 검토 필요",
};
export const policyTitle = (type: PolicyType) => type === "TERMS" ? "이용약관" : "개인정보처리방침 및 필수 수집·이용 동의";

function OriginalText({ text }: { text: string }) {
  return <div className="policy-original">{text.split(/\n\s*\n/).map((block, index) => {
    const heading = block.trim().match(/^(?:#{1,4}\s+|\*\*)([^\n]+?)(?:\*\*)?$/);
    if (heading) return <h3 key={index}>{heading[1]}</h3>;
    if (block.split("\n").every(line => line.startsWith("- "))) return <ul key={index}>{block.split("\n").map((line, i) => <li key={i}>{line.slice(2)}</li>)}</ul>;
    return <p key={index}>{block}</p>;
  })}</div>;
}
export function PolicyContent({ type, document }: { type: PolicyType; document?: PolicyDocument }) {
  return <article className="policy-content">
    <p className="member-note">{policyPublication.review} · 시행일: {policyPublication.effectiveDate}</p>
    <dl className="policy-publication"><div><dt>운영 주체</dt><dd>{policyPublication.operator}</dd></div><div><dt>문의</dt><dd>{policyPublication.contact}</dd></div>{type === "PRIVACY" && <div><dt>개인정보 보호 담당</dt><dd>{policyPublication.privacyOfficer}</dd></div>}</dl>
    {document && <section><h2>현재 동의 대상 원문 · {document.version}</h2><p className="member-note">서버 등록 개발 초안 · 이 원문의 버전에 동의합니다.</p><OriginalText text={document.text} /></section>}
    <details open={!document}><summary>정식 게시 검토용 전체 원고 · frontend-draft-2026-10-23</summary><p className="member-note">서비스 소유자가 제공한 전체 초안입니다. 서버 등록 원문과 별개이며 현재 동의 기록의 대상이 아닙니다.</p><OriginalText text={drafts[type]} /></details>
    <p className="member-note">정책 페이지와 가입·재동의 팝업은 같은 원문을 표시합니다. <Link href={type === "TERMS" ? "/terms" : "/privacy"}>정책 페이지 열기</Link></p>
  </article>;
}
