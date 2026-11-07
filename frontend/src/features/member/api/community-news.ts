import { ContentApiError, contentJson } from "./client";
import type { MemberSession, MemberSnapshot } from "./session";

export type NewsCategory = "CRYPTO" | "MACRO" | "ONCHAIN" | "REGULATION";
export type CommunityCategory = "MARKET" | "ANALYSIS" | "POSITION" | "FREE";
export type CommunitySort = "LATEST" | "POPULAR";

export const NEWS_CATEGORIES: readonly { key: "" | NewsCategory; label: string }[] = [
  { key: "", label: "전체" },
  { key: "CRYPTO", label: "코인 시황 (CRYPTO)" },
  { key: "MACRO", label: "거시·세계 경제 (MACRO)" },
  { key: "ONCHAIN", label: "온체인·수급 (ONCHAIN)" },
  { key: "REGULATION", label: "규제·정책 (REGULATION)" },
];

export const COMMUNITY_CATEGORIES: readonly { key: "" | CommunityCategory; label: string }[] = [
  { key: "", label: "전체" },
  { key: "MARKET", label: "시황·관점 (MARKET)" },
  { key: "ANALYSIS", label: "차트 분석 (ANALYSIS)" },
  { key: "POSITION", label: "포지션 공유 (POSITION)" },
  { key: "FREE", label: "자유 (FREE)" },
];

export const SYMBOL_FILTER_TAGS = ["", "BTC", "ETH", "SOL", "XRP"] as const;

export type NewsItem = {
  id: number;
  category: NewsCategory;
  title: string;
  summary: string;
  content: string;
  sourceName: string;
  symbolTag: string | null;
  publishedAt: string;
};

export type NewsPage = {
  items: NewsItem[];
  hasNext: boolean;
  nextCursorId: number | null;
};

export type CommunityPost = {
  id: number;
  memberId: number;
  authorNickname: string;
  authorWithdrawn: boolean;
  category: CommunityCategory;
  symbolTag: string | null;
  title: string;
  content: string;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  mine: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CommunityPostPage = {
  items: CommunityPost[];
  hasNext: boolean;
  nextCursorId: number | null;
};

export type CommunityLikeResult = {
  postId: number;
  likeCount: number;
  likedByMe: boolean;
};

export type CommunityComment = {
  id: number;
  postId: number;
  memberId: number;
  authorNickname: string;
  authorWithdrawn: boolean;
  parentCommentId: number | null;
  content: string;
  mine: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CommunityCommentList = {
  items: CommunityComment[];
};

const fail = (): never => { throw new ContentApiError(422); };
const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : fail();
const posInt = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fail();
const nonNegInt = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fail();
const str = (value: unknown, max = 10000): string =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : fail();
const iso = (value: unknown): string =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : fail();
const optStr = (value: unknown, max = 20): string | null =>
  value === null || value === undefined ? null : str(value, max);

export function newsCategoryLabel(category: NewsCategory): string {
  switch (category) {
    case "CRYPTO": return "코인 시황";
    case "MACRO": return "거시·세계 경제";
    case "ONCHAIN": return "온체인·수급";
    case "REGULATION": return "규제·정책";
  }
}

export function communityCategoryLabel(category: CommunityCategory): string {
  switch (category) {
    case "MARKET": return "시황·관점";
    case "ANALYSIS": return "차트 분석";
    case "POSITION": return "포지션 공유";
    case "FREE": return "자유";
  }
}

export function parseNewsItem(value: unknown): NewsItem {
  const row = obj(value);
  const category = row.category;
  if (category !== "CRYPTO" && category !== "MACRO" && category !== "ONCHAIN" && category !== "REGULATION") return fail();
  return {
    id: posInt(row.id),
    category,
    title: str(row.title, 300),
    summary: str(row.summary, 1000),
    content: str(row.content, 20000),
    sourceName: str(row.sourceName, 120),
    symbolTag: optStr(row.symbolTag, 20),
    publishedAt: iso(row.publishedAt),
  };
}

export function parseNewsPage(value: unknown): NewsPage {
  const row = obj(value);
  if (!Array.isArray(row.items) || typeof row.hasNext !== "boolean") return fail();
  return {
    items: row.items.map(parseNewsItem),
    hasNext: row.hasNext,
    nextCursorId: row.nextCursorId === null || row.nextCursorId === undefined ? null : posInt(row.nextCursorId),
  };
}

export function parseCommunityPost(value: unknown): CommunityPost {
  const row = obj(value);
  const category = row.category;
  if (category !== "MARKET" && category !== "ANALYSIS" && category !== "POSITION" && category !== "FREE") return fail();
  if (typeof row.authorWithdrawn !== "boolean" || typeof row.likedByMe !== "boolean" || typeof row.mine !== "boolean") return fail();
  const authorWithdrawn = row.authorWithdrawn;
  const authorNickname = authorWithdrawn ? "탈퇴한회원" : str(row.authorNickname, 40);
  return {
    id: posInt(row.id),
    memberId: posInt(row.memberId),
    authorNickname,
    authorWithdrawn,
    category,
    symbolTag: optStr(row.symbolTag, 20),
    title: str(row.title, 200),
    content: str(row.content, 10000),
    likeCount: nonNegInt(row.likeCount),
    commentCount: nonNegInt(row.commentCount),
    likedByMe: row.likedByMe,
    mine: row.mine,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function parseCommunityPostPage(value: unknown): CommunityPostPage {
  const row = obj(value);
  if (!Array.isArray(row.items) || typeof row.hasNext !== "boolean") return fail();
  return {
    items: row.items.map(parseCommunityPost),
    hasNext: row.hasNext,
    nextCursorId: row.nextCursorId === null || row.nextCursorId === undefined ? null : posInt(row.nextCursorId),
  };
}

export function parseCommunityLike(value: unknown): CommunityLikeResult {
  const row = obj(value);
  if (typeof row.likedByMe !== "boolean") return fail();
  return {
    postId: posInt(row.postId),
    likeCount: nonNegInt(row.likeCount),
    likedByMe: row.likedByMe,
  };
}

export function parseCommunityComment(value: unknown): CommunityComment {
  const row = obj(value);
  if (typeof row.authorWithdrawn !== "boolean" || typeof row.mine !== "boolean") return fail();
  const authorWithdrawn = row.authorWithdrawn;
  const authorNickname = authorWithdrawn ? "탈퇴한회원" : str(row.authorNickname, 40);
  return {
    id: posInt(row.id),
    postId: posInt(row.postId),
    memberId: posInt(row.memberId),
    authorNickname,
    authorWithdrawn,
    parentCommentId: row.parentCommentId === null || row.parentCommentId === undefined ? null : posInt(row.parentCommentId),
    content: str(row.content, 2000),
    mine: row.mine,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function parseCommunityComments(value: unknown): CommunityCommentList {
  const row = obj(value);
  if (!Array.isArray(row.items)) return fail();
  return { items: row.items.map(parseCommunityComment) };
}

export function newsPath(params: { category?: string; symbolTag?: string; keyword?: string; cursorId?: number | null; size?: number } = {}): string {
  const search = new URLSearchParams();
  if (params.category) search.set("category", params.category);
  if (params.symbolTag) search.set("symbolTag", params.symbolTag);
  if (params.keyword?.trim()) search.set("keyword", params.keyword.trim());
  if (params.cursorId) search.set("cursorId", String(params.cursorId));
  search.set("size", String(params.size ?? 10));
  const query = search.toString();
  return query ? `/news?${query}` : "/news";
}

export function communityPostsPath(params: { category?: string; sort?: CommunitySort; symbolTag?: string; keyword?: string; cursorId?: number | null; size?: number } = {}): string {
  const search = new URLSearchParams();
  if (params.category) search.set("category", params.category);
  search.set("sort", params.sort ?? "LATEST");
  if (params.symbolTag) search.set("symbolTag", params.symbolTag);
  if (params.keyword?.trim()) search.set("keyword", params.keyword.trim());
  if (params.cursorId) search.set("cursorId", String(params.cursorId));
  search.set("size", String(params.size ?? 10));
  return `/community/posts?${search.toString()}`;
}

export async function readCommunityOrPublic(
  origin: string,
  session: Pick<MemberSession, "request">,
  snapshot: Pick<MemberSnapshot, "phase">,
  path: string,
  signal?: AbortSignal,
  transport: typeof fetch = fetch,
): Promise<unknown> {
  if (snapshot.phase === "ready") {
    return session.request(path, { signal });
  }
  return contentJson(origin, path, { signal }, transport);
}
