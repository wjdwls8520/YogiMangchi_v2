import { ContentApiError, contentJson } from "./client";
import type { MemberSession, MemberSnapshot } from "./session";

export type NewsCategory = "CRYPTO" | "MACRO" | "ONCHAIN" | "REGULATION";
export type NewsSection = "BREAKING" | "NEWSROOM";
export type NewsSubCategory = "COIN_FLASH" | "ECONOMY_FLASH" | "CRYPTO" | "STOCKS" | "FX_RATES";
export type NewsSentiment = "BULLISH" | "BEARISH" | "NEUTRAL";
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
  section?: NewsSection;
  subCategory?: NewsSubCategory;
  title: string;
  summary: string;
  content: string;
  sourceName: string;
  sourceUrl?: string | null;
  thumbnailUrl?: string | null;
  aiSummary?: string | null;
  sentiment?: NewsSentiment;
  bullCount?: number;
  bearCount?: number;
  viewCount?: number;
  symbolTag: string | null;
  publishedAt: string;
};

export type NewsPage = {
  items: NewsItem[];
  hasNext: boolean;
  nextCursorId: number | null;
};

export type NewsReactionResult = {
  newsId: number;
  reaction: "BULL" | "BEAR" | string;
  bullCount: number;
  bearCount: number;
  bullPct: number;
  bearPct: number;
};

export type NewsKeywordIssueItem = {
  keyword: string;
  label: string;
  articleCount: number;
  sentiment: NewsSentiment;
  articles: NewsItem[];
};

export type NewsSentimentSummary = {
  totalBullVotes: number;
  totalBearVotes: number;
  bullPct: number;
  bearPct: number;
  dominantSentiment: NewsSentiment;
};

export type NewsLiveStatus = {
  live: boolean;
  collectorEnabled: boolean;
  retentionHours: number;
  lastCollectedAt: string | null;
};

export type NewsHighlights = {
  mustReadBreaking: NewsItem[];
  popularByViews: NewsItem[];
  popularByReactions: NewsItem[];
  keywordIssues: NewsKeywordIssueItem[];
  recommendedNewsroom: NewsItem[];
  sentimentSummary: NewsSentimentSummary;
  liveStatus?: NewsLiveStatus;
};

export type CommunityPostFile = {
  id: number;
  postId: number;
  originalName: string;
  size: number;
  url: string;
  contentType: string;
  createdAt: string;
};

export type SharedPositionSnapshot = {
  id: string;
  marketLabel: "모의투자 선물" | "시즌 1 대회" | string;
  symbol: "BTC" | "ETH" | "SOL" | "XRP" | string;
  pair: string;
  side: "LONG" | "SHORT";
  leverage: number;
  entryPrice: string;
  markPrice: string;
  liquidationPrice: string;
  roePct: string;
  pnlUsdt: string;
  positive: boolean;
  showPnlAmount?: boolean;
  verified?: boolean;
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
  reportCount?: number;
  likedByMe: boolean;
  reportedByMe?: boolean;
  mine: boolean;
  files?: CommunityPostFile[];
  sharedPosition?: SharedPositionSnapshot | null;
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

export type CommunityCommentLikeResult = {
  commentId: number;
  likeCount: number;
  likedByMe: boolean;
};

export type CommunityReportResult = {
  targetId: number;
  reportCount: number;
  reportedByMe: boolean;
};

export type CommunityReportReason = {
  code: string;
  description: string;
};

export type LatestPostsCheck = {
  newPostCount: number;
  latestPostId: number | null;
  items: CommunityPost[];
};

export type CommunityComment = {
  id: number;
  postId: number;
  memberId: number;
  authorNickname: string;
  authorWithdrawn: boolean;
  parentCommentId: number | null;
  targetCommentId?: number | null;
  targetMemberId?: number | null;
  targetNickname?: string | null;
  content: string;
  likeCount?: number;
  reportCount?: number;
  likedByMe?: boolean;
  reportedByMe?: boolean;
  mine: boolean;
  deleted?: boolean;
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
  const rawSection = row.section;
  const section: NewsSection =
    rawSection === "BREAKING" || rawSection === "NEWSROOM" ? rawSection : "BREAKING";
  const rawSub = row.subCategory;
  const subCategory: NewsSubCategory =
    rawSub === "COIN_FLASH" ||
    rawSub === "ECONOMY_FLASH" ||
    rawSub === "CRYPTO" ||
    rawSub === "STOCKS" ||
    rawSub === "FX_RATES"
      ? rawSub
      : category === "MACRO" || category === "REGULATION"
        ? "ECONOMY_FLASH"
        : "COIN_FLASH";
  const rawSentiment = row.sentiment;
  const sentiment: NewsSentiment =
    rawSentiment === "BULLISH" || rawSentiment === "BEARISH" || rawSentiment === "NEUTRAL"
      ? rawSentiment
      : "NEUTRAL";
  return {
    id: posInt(row.id),
    category,
    section,
    subCategory,
    title: str(row.title, 300),
    summary: str(row.summary, 1000),
    content: str(row.content, 20000),
    sourceName: str(row.sourceName, 120),
    sourceUrl:
      typeof row.sourceUrl === "string" && row.sourceUrl.trim().length > 0
        ? str(row.sourceUrl, 2000)
        : null,
    thumbnailUrl:
      typeof row.thumbnailUrl === "string" && row.thumbnailUrl.trim().length > 0
        ? str(row.thumbnailUrl, 2000)
        : null,
    aiSummary:
      typeof row.aiSummary === "string" && row.aiSummary.trim().length > 0
        ? str(row.aiSummary, 2000)
        : null,
    sentiment,
    bullCount: typeof row.bullCount === "number" ? nonNegInt(row.bullCount) : 0,
    bearCount: typeof row.bearCount === "number" ? nonNegInt(row.bearCount) : 0,
    viewCount: typeof row.viewCount === "number" ? nonNegInt(row.viewCount) : 0,
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

export function parseNewsReaction(value: unknown): NewsReactionResult {
  const row = obj(value);
  return {
    newsId: posInt(row.newsId),
    reaction: typeof row.reaction === "string" ? str(row.reaction, 20) : "BULL",
    bullCount: nonNegInt(row.bullCount),
    bearCount: nonNegInt(row.bearCount),
    bullPct: typeof row.bullPct === "number" ? nonNegInt(row.bullPct) : 50,
    bearPct: typeof row.bearPct === "number" ? nonNegInt(row.bearPct) : 50,
  };
}

export function parseNewsLiveStatus(value: unknown): NewsLiveStatus {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const collectorEnabled =
    typeof row.collectorEnabled === "boolean" ? row.collectorEnabled : true;
  const live = typeof row.live === "boolean" ? row.live : collectorEnabled;
  const retentionHours =
    typeof row.retentionHours === "number" && Number.isFinite(row.retentionHours)
      ? Math.max(1, Math.trunc(row.retentionHours))
      : 6;
  const lastCollectedAt =
    typeof row.lastCollectedAt === "string" && Number.isFinite(Date.parse(row.lastCollectedAt))
      ? row.lastCollectedAt
      : null;
  return {
    live,
    collectorEnabled,
    retentionHours,
    lastCollectedAt,
  };
}

export function parseNewsHighlights(value: unknown): NewsHighlights {
  const row = obj(value);
  const parseList = (list: unknown): NewsItem[] =>
    Array.isArray(list) ? list.map(parseNewsItem) : [];
  const rawIssues = Array.isArray(row.keywordIssues) ? row.keywordIssues : [];
  const keywordIssues: NewsKeywordIssueItem[] = rawIssues.map(item => {
    const issue = obj(item);
    const s = issue.sentiment;
    const sentiment: NewsSentiment =
      s === "BULLISH" || s === "BEARISH" || s === "NEUTRAL" ? s : "NEUTRAL";
    const kw = str(issue.keyword, 60);
    return {
      keyword: kw,
      label:
        typeof issue.label === "string" && issue.label.length > 0
          ? str(issue.label, 120)
          : kw,
      articleCount: typeof issue.articleCount === "number" ? nonNegInt(issue.articleCount) : 0,
      sentiment,
      articles: parseList(issue.articles),
    };
  });
  const rawSummary =
    row.sentimentSummary && typeof row.sentimentSummary === "object"
      ? (row.sentimentSummary as Record<string, unknown>)
      : {};
  const dom = rawSummary.dominantSentiment;
  const dominantSentiment: NewsSentiment =
    dom === "BULLISH" || dom === "BEARISH" || dom === "NEUTRAL" ? dom : "NEUTRAL";
  return {
    mustReadBreaking: parseList(row.mustReadBreaking),
    popularByViews: parseList(row.popularByViews),
    popularByReactions: parseList(row.popularByReactions),
    keywordIssues,
    recommendedNewsroom: parseList(row.recommendedNewsroom),
    sentimentSummary: {
      totalBullVotes:
        typeof rawSummary.totalBullVotes === "number"
          ? nonNegInt(rawSummary.totalBullVotes)
          : 0,
      totalBearVotes:
        typeof rawSummary.totalBearVotes === "number"
          ? nonNegInt(rawSummary.totalBearVotes)
          : 0,
      bullPct: typeof rawSummary.bullPct === "number" ? nonNegInt(rawSummary.bullPct) : 50,
      bearPct: typeof rawSummary.bearPct === "number" ? nonNegInt(rawSummary.bearPct) : 50,
      dominantSentiment,
    },
    liveStatus: parseNewsLiveStatus(row.liveStatus),
  };
}

export function parseCommunityPostFile(value: unknown): CommunityPostFile {
  const row = obj(value);
  return {
    id: posInt(row.id),
    postId: posInt(row.postId),
    originalName: str(row.originalName, 260),
    size: nonNegInt(row.size),
    url: str(row.url, 2000),
    contentType: str(row.contentType, 120),
    createdAt: iso(row.createdAt),
  };
}

export function parseSharedPositionSnapshot(value: unknown): SharedPositionSnapshot {
  const row = obj(value);
  const side = row.side;
  if (side !== "LONG" && side !== "SHORT") return fail();
  if (typeof row.positive !== "boolean") return fail();
  return {
    id: str(row.id, 100),
    marketLabel: str(row.marketLabel, 60),
    symbol: str(row.symbol, 20),
    pair: str(row.pair, 30),
    side,
    leverage: posInt(row.leverage),
    entryPrice: str(row.entryPrice, 60),
    markPrice: str(row.markPrice, 60),
    liquidationPrice: str(row.liquidationPrice, 60),
    roePct: str(row.roePct, 40),
    pnlUsdt: str(row.pnlUsdt, 60),
    positive: row.positive,
    showPnlAmount: typeof row.showPnlAmount === "boolean" ? row.showPnlAmount : true,
    verified: typeof row.verified === "boolean" ? row.verified : true,
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
    reportCount: typeof row.reportCount === "number" ? nonNegInt(row.reportCount) : 0,
    likedByMe: row.likedByMe,
    reportedByMe: typeof row.reportedByMe === "boolean" ? row.reportedByMe : false,
    mine: row.mine,
    files: Array.isArray(row.files) ? row.files.map(parseCommunityPostFile) : [],
    sharedPosition: row.sharedPosition ? parseSharedPositionSnapshot(row.sharedPosition) : null,
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

export function parseCommentLike(value: unknown): CommunityCommentLikeResult {
  const row = obj(value);
  if (typeof row.likedByMe !== "boolean") return fail();
  return {
    commentId: posInt(row.commentId),
    likeCount: nonNegInt(row.likeCount),
    likedByMe: row.likedByMe,
  };
}

export function parseCommunityReport(value: unknown): CommunityReportResult {
  const row = obj(value);
  if (typeof row.reportedByMe !== "boolean") return fail();
  return {
    targetId: posInt(row.targetId),
    reportCount: nonNegInt(row.reportCount),
    reportedByMe: row.reportedByMe,
  };
}

export function parseReportReasons(value: unknown): CommunityReportReason[] {
  if (!Array.isArray(value)) return fail();
  return value.map(item => {
    const row = obj(item);
    return {
      code: str(row.code, 60),
      description: str(row.description, 200),
    };
  });
}

export function parseLatestPostsCheck(value: unknown): LatestPostsCheck {
  const row = obj(value);
  if (!Array.isArray(row.items)) return fail();
  return {
    newPostCount: nonNegInt(row.newPostCount),
    latestPostId: row.latestPostId === null || row.latestPostId === undefined ? null : posInt(row.latestPostId),
    items: row.items.map(parseCommunityPost),
  };
}

export function parseCommunityComment(value: unknown): CommunityComment {
  const row = obj(value);
  if (typeof row.authorWithdrawn !== "boolean" || typeof row.mine !== "boolean") return fail();
  const authorWithdrawn = row.authorWithdrawn;
  const authorNickname = authorWithdrawn ? "탈퇴한회원" : str(row.authorNickname, 40);
  const deleted = typeof row.deleted === "boolean" ? row.deleted : false;
  return {
    id: posInt(row.id),
    postId: posInt(row.postId),
    memberId: posInt(row.memberId),
    authorNickname,
    authorWithdrawn,
    parentCommentId: row.parentCommentId === null || row.parentCommentId === undefined ? null : posInt(row.parentCommentId),
    targetCommentId: row.targetCommentId === null || row.targetCommentId === undefined ? null : posInt(row.targetCommentId),
    targetMemberId: row.targetMemberId === null || row.targetMemberId === undefined ? null : posInt(row.targetMemberId),
    targetNickname: optStr(row.targetNickname, 40),
    content: deleted && (typeof row.content !== "string" || row.content.length === 0) ? "삭제된 댓글입니다." : str(row.content, 2000),
    likeCount: typeof row.likeCount === "number" ? nonNegInt(row.likeCount) : 0,
    reportCount: typeof row.reportCount === "number" ? nonNegInt(row.reportCount) : 0,
    likedByMe: typeof row.likedByMe === "boolean" ? row.likedByMe : false,
    reportedByMe: typeof row.reportedByMe === "boolean" ? row.reportedByMe : false,
    mine: row.mine,
    deleted,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function parseCommunityComments(value: unknown): CommunityCommentList {
  const row = obj(value);
  if (!Array.isArray(row.items)) return fail();
  return { items: row.items.map(parseCommunityComment) };
}

export type NewsSort = "LATEST" | "OLDEST" | "POPULAR";

export function newsPath(params: {
  category?: string;
  section?: NewsSection | string;
  subCategory?: NewsSubCategory | string;
  sort?: NewsSort;
  symbolTag?: string;
  keyword?: string;
  cursorId?: number | null;
  size?: number;
} = {}): string {
  const search = new URLSearchParams();
  if (params.category) search.set("category", params.category);
  if (params.section) search.set("section", params.section);
  if (params.subCategory) search.set("subCategory", params.subCategory);
  if (params.sort) search.set("sort", params.sort);
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
