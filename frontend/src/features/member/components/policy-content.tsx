import Link from "next/link";
import type { ReactNode } from "react";
import type { PolicyType, PolicyDocument } from "../api/policies";
export type { PolicyType, PolicyDocument } from "../api/policies";

export const policyTitle = (type: PolicyType) =>
  type === "TERMS" ? "이용약관" : "개인정보처리방침 및 필수 수집·이용 동의";

export function sanitizePolicyDisplayText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]*\(ym-[a-z0-9-]+\)/gi, "")
    .replace(/[ \t]*·[ \t]*문서[ \t]*상태:[ \t]*[^\r\n]+/g, "");
}

export type PolicyMarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "paragraph"; lines: string[] };

export function parsePolicyMarkdownBlocks(rawText: string): PolicyMarkdownBlock[] {
  const sanitized = sanitizePolicyDisplayText(rawText);
  const rawLines = sanitized.split("\n");
  const blocks: PolicyMarkdownBlock[] = [];
  let paragraphLines: string[] = [];
  let ulItems: string[] = [];
  let olItems: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length > 0) {
      blocks.push({ type: "paragraph", lines: paragraphLines });
      paragraphLines = [];
    }
  };
  const flushUl = () => {
    if (ulItems.length > 0) {
      blocks.push({ type: "ul", items: ulItems });
      ulItems = [];
    }
  };
  const flushOl = () => {
    if (olItems.length > 0) {
      blocks.push({ type: "ol", items: olItems });
      olItems = [];
    }
  };
  const flushAll = () => {
    flushParagraph();
    flushUl();
    flushOl();
  };

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      flushAll();
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      flushAll();
      const level = Math.min(3, headingMatch[1].length) as 1 | 2 | 3;
      const headingText = headingMatch[2].replace(/^\*\*(.+)\*\*$/, "$1").trim();
      blocks.push({ type: "heading", level, text: headingText });
      continue;
    }

    const boldOnlyHeading = trimmed.match(/^\*\*([^*]+)\*\*$/);
    if (boldOnlyHeading) {
      flushAll();
      blocks.push({ type: "heading", level: 3, text: boldOnlyHeading[1].trim() });
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*•]\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      flushOl();
      ulItems.push(bulletMatch[1].trim());
      continue;
    }

    const articleHeadingMatch = trimmed.match(/^제\d+조(?:\s*\([^)]+\))?$/);
    if (articleHeadingMatch) {
      flushAll();
      blocks.push({ type: "heading", level: 3, text: trimmed });
      continue;
    }

    const numberedSectionHeading = trimmed.match(/^\d+\.\s+(.+)$/);
    if (numberedSectionHeading) {
      // Distinguish a short section heading (e.g. "2. 수집하는 개인정보 항목") from consecutive numbered list items
      const isShortSectionTitle =
        paragraphLines.length === 0 &&
        olItems.length === 0 &&
        numberedSectionHeading[1].length <= 45 &&
        !/[.!?]$/.test(numberedSectionHeading[1]);
      if (isShortSectionTitle) {
        flushAll();
        blocks.push({ type: "heading", level: 3, text: trimmed });
      } else {
        flushParagraph();
        flushUl();
        olItems.push(numberedSectionHeading[1].trim());
      }
      continue;
    }

    flushUl();
    flushOl();
    paragraphLines.push(trimmed);
  }

  flushAll();
  return blocks;
}

function renderInlineBold(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  if (parts.length === 1) return text;
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    return <span key={idx}>{part}</span>;
  });
}

export function PolicyMarkdownBody({ text }: { text: string }) {
  const blocks = parsePolicyMarkdownBlocks(text);
  return (
    <div className="policy-original">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          if (block.level === 1) {
            return (
              <h3 key={index} className="policy-doc-title">
                {renderInlineBold(block.text)}
              </h3>
            );
          }
          return <h3 key={index}>{renderInlineBold(block.text)}</h3>;
        }
        if (block.type === "ul") {
          return (
            <ul key={index}>
              {block.items.map((item, i) => (
                <li key={i}>{renderInlineBold(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === "ol") {
          return (
            <ol key={index} className="mb-4 list-decimal space-y-2 pl-5">
              {block.items.map((item, i) => (
                <li key={i}>{renderInlineBold(item)}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={index}>
            {block.lines.map((line, i) => (
              <span key={i}>
                {i > 0 && <br />}
                {renderInlineBold(line)}
              </span>
            ))}
          </p>
        );
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
            <span>{isPublished ? `시행 중인 공식 ${label}` : label}</span>
          </div>
          <Link
            href="/support"
            className="text-xs font-bold text-[#0058FF] hover:underline"
          >
            약관·개인정보 문의 (1:1 고객센터) →
          </Link>
        </div>
        <section>
          <h2>{label} 전문</h2>
          <p className="member-note">
            {isPublished
              ? "현재 서비스에 적용 중인 공식 약관입니다."
              : "현재 동의 대상 약관입니다."}
          </p>
          <PolicyMarkdownBody text={document.text} />
        </section>
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
