import Link from "next/link";
import type { PolicyType, PolicyDocument } from "../api/policies";
export type { PolicyType, PolicyDocument } from "../api/policies";

export const policyTitle = (type: PolicyType) =>
  type === "TERMS" ? "이용약관" : "개인정보처리방침 및 필수 수집·이용 동의";

function OriginalText({ text }: { text: string }) {
  return (
    <div className="policy-original">
      {text.split(/\n\s*\n/).map((block, index) => {
        const heading = block.trim().match(/^(?:#{1,4}\s+|\*\*)([^\n]+?)(?:\*\*)?$/);
        if (heading) return <h3 key={index}>{heading[1]}</h3>;
        if (block.split("\n").every(line => line.startsWith("- "))) {
          return (
            <ul key={index}>
              {block.split("\n").map((line, i) => (
                <li key={i}>{line.slice(2)}</li>
              ))}
            </ul>
          );
        }
        return <p key={index}>{block}</p>;
      })}
    </div>
  );
}

export function PolicyContent({ type, document }: { type: PolicyType; document?: PolicyDocument }) {
  if (document) {
    const isPublished = document.documentStatus === "PUBLISHED";
    const label = type === "TERMS" ? "이용약관" : "개인정보처리방침";
    return (
      <article className="policy-content">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-bold text-[#0058FF]">
            <span className="inline-flex items-center rounded-md bg-[#0058FF] px-2 py-0.5 text-[10px] font-extrabold text-white">
              {isPublished ? "확정" : "안내"}
            </span>
            <span>
              {isPublished
                ? `시행 중인 공식 약관 · ${document.version}`
                : `${label} · ${document.version}`}
            </span>
          </div>
          <Link
            href="/support"
            className="text-xs font-bold text-[#0058FF] hover:underline"
          >
            약관·개인정보 문의 (1:1 고객센터) →
          </Link>
        </div>
        <section>
          <h2>동의 대상 원문 · {document.version}</h2>
          <p className="member-note">
            {isPublished
              ? "현재 서비스에 적용 중인 확정 원문입니다. 이 버전에 동의합니다."
              : "현재 동의 대상 원문입니다. 이 버전에 동의합니다."}
          </p>
          <OriginalText text={document.text} />
        </section>
        <p className="member-note">
          정책 페이지와 가입·재동의 팝업은 같은 원문을 표시합니다.{" "}
          <Link href={type === "TERMS" ? "/terms" : "/privacy"}>정책 페이지 열기</Link>
        </p>
      </article>
    );
  }

  return (
    <article className="policy-content">
      <div
        role="status"
        className="space-y-3 rounded-2xl border border-gray-200 bg-[#F9FAFB] p-6 text-center"
      >
        <p className="text-sm font-bold text-gray-800">
          현재 약관 원문을 불러오지 못했습니다. 잠시 후 다시 시도하거나 1:1 고객센터로 문의해 주세요.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
          <Link
            href="/support"
            className="inline-flex h-10 items-center justify-center rounded-xl bg-[#0058FF] px-4 text-xs font-bold text-white transition-colors hover:bg-blue-700"
          >
            1:1 고객센터로 문의하기 →
          </Link>
        </div>
      </div>
    </article>
  );
}
