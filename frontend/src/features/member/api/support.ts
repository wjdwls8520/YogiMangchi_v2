import { ContentApiError } from "./client";

export type SupportInquiryCategory =
  | "ACCOUNT"
  | "TRADING"
  | "CONTEST"
  | "COMMUNITY"
  | "BUG"
  | "GENERAL"
  | "ETC";

export type SupportInquiryStatus = "OPEN" | "ANSWERED";
export type SupportInquiryFilterStatus = "ALL" | SupportInquiryStatus;

export const SUPPORT_INQUIRY_CATEGORIES: readonly {
  code: SupportInquiryCategory;
  label: string;
}[] = [
  { code: "ACCOUNT", label: "계정 · 로그인" },
  { code: "TRADING", label: "선물 모의투자" },
  { code: "CONTEST", label: "모의투자 대회" },
  { code: "COMMUNITY", label: "커뮤니티 · 신고" },
  { code: "BUG", label: "오류 · 버그 제보" },
  { code: "GENERAL", label: "일반 서비스 문의" },
  { code: "ETC", label: "기타" },
];

export function supportCategoryLabel(code: string): string {
  const matched = SUPPORT_INQUIRY_CATEGORIES.find(item => item.code === code);
  return matched ? matched.label : code;
}

export interface SupportInquiry {
  id: number;
  memberId: number;
  memberNickname: string;
  category: string;
  title: string;
  content: string;
  status: SupportInquiryStatus;
  adminReply: string | null;
  repliedByMemberId: number | null;
  repliedAt: string | null;
  createdAt: string;
}

export interface SupportInquiryPage {
  items: SupportInquiry[];
  hasNext: boolean;
  nextCursorId: number | null;
}

export interface AdminSupportInquiryPage extends SupportInquiryPage {
  openCount: number;
  answeredCount: number;
}

const fail = (): never => {
  throw new ContentApiError(422);
};

const asObj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail();

const posInt = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fail();

const nonNegInt = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fail();

const reqStr = (value: unknown, max = 5000): string =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : fail();

const optStr = (value: unknown, max = 5000): string | null =>
  value === null || value === undefined
    ? null
    : typeof value === "string" && value.length <= max
      ? value
      : fail();

const isoStr = (value: unknown): string =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : fail();

export function parseSupportInquiry(value: unknown): SupportInquiry {
  const row = asObj(value);
  const status = row.status === "ANSWERED" ? "ANSWERED" : row.status === "OPEN" ? "OPEN" : fail();
  return {
    id: posInt(row.id),
    memberId: posInt(row.memberId),
    memberNickname:
      typeof row.memberNickname === "string" && row.memberNickname.length > 0
        ? row.memberNickname
        : "회원",
    category: reqStr(row.category, 32),
    title: reqStr(row.title, 200),
    content: reqStr(row.content, 5000),
    status,
    adminReply: optStr(row.adminReply, 5000),
    repliedByMemberId:
      row.repliedByMemberId === null || row.repliedByMemberId === undefined
        ? null
        : posInt(row.repliedByMemberId),
    repliedAt:
      row.repliedAt === null || row.repliedAt === undefined ? null : isoStr(row.repliedAt),
    createdAt: isoStr(row.createdAt),
  };
}

export function parseSupportInquiryPage(value: unknown): SupportInquiryPage {
  const row = asObj(value);
  if (!Array.isArray(row.items) || typeof row.hasNext !== "boolean") return fail();
  return {
    items: row.items.map(parseSupportInquiry),
    hasNext: row.hasNext,
    nextCursorId:
      row.nextCursorId === null || row.nextCursorId === undefined
        ? null
        : posInt(row.nextCursorId),
  };
}

export function parseAdminSupportInquiryPage(value: unknown): AdminSupportInquiryPage {
  const row = asObj(value);
  const base = parseSupportInquiryPage(row);
  return {
    ...base,
    openCount: nonNegInt(row.openCount),
    answeredCount: nonNegInt(row.answeredCount),
  };
}

export function mySupportInquiriesPath(params: {
  status?: SupportInquiryFilterStatus;
  cursorId?: number | null;
  size?: number;
} = {}): string {
  const search = new URLSearchParams();
  if (params.status && params.status !== "ALL") search.set("status", params.status);
  else search.set("status", "ALL");
  if (params.cursorId) search.set("cursorId", String(params.cursorId));
  search.set("size", String(params.size ?? 20));
  return `/support/inquiries/me?${search.toString()}`;
}
