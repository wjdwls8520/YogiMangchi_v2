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
  authorProfileImgUrl?: string | null;
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
  authorProfileImgUrl?: string | null;
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
  hasNext: boolean;
  nextCursorId: number | null;
};

export type MemberCommunityCommentItem = {
  id: number;
  postId: number;
  postTitle: string;
  postCategory: CommunityCategory | string;
  postSymbolTag: string | null;
  memberId: number;
  authorNickname: string;
  authorProfileImgUrl?: string | null;
  authorWithdrawn: boolean;
  parentCommentId: number | null;
  targetCommentId: number | null;
  targetMemberId: number | null;
  targetNickname: string | null;
  content: string;
  likeCount: number;
  reportCount: number;
  likedByMe: boolean;
  reportedByMe: boolean;
  mine: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MemberCommunityCommentPage = {
  items: MemberCommunityCommentItem[];
  hasNext: boolean;
  nextCursorId: number | null;
};

export type MemberCommunityReportItem = {
  id: number;
  targetType: "POST" | "COMMENT";
  targetId: number;
  postId: number;
  title: string;
  postTitle: string;
  targetPreview: string;
  reasonType: string;
  reasonDescription: string;
  reason: string;
  status: string;
  createdAt: string;
};

export type MemberCommunityReportPage = {
  items: MemberCommunityReportItem[];
  hasNext: boolean;
  nextCursorId: number | null;
};

export type PublicPortfolioWallet = {
  balance: string;
  availableBalance: string;
  usedMargin: string;
  reservedMargin: string;
  totalEquity: string;
  unrealizedPnl: string;
  realizedPnl: string;
  totalPnl: string;
  totalRoiPct: string;
  priceFresh: boolean;
};

export type PublicPortfolioAllocation = {
  usedMarginRatioPct: string;
  availableCashRatioPct: string;
  longMarginUsdt: string;
  shortMarginUsdt: string;
  longRatioPct: string;
  shortRatioPct: string;
  longPositionCount: number;
  shortPositionCount: number;
};

export type PublicPortfolioPositionItem = {
  id: number;
  symbol: string;
  tradingSymbolId: number | null;
  side: "LONG" | "SHORT";
  leverage: number;
  quantity: string;
  entryPrice: string;
  markPrice: string;
  liquidationPrice: string;
  margin: string;
  unrealizedPnl: string;
  roePct: string;
  marginRatioPct: string;
};

export type PublicPortfolioSymbolPerformance = {
  tradingSymbolId: number | null;
  symbol: string;
  quoteAsset: string;
  fillCount: number;
  executedNotional: string;
  turnover: string;
  turnoverSharePercent: string;
  realizedPnl: string;
  grossRealizedPnl: string;
  economicPnl: string;
  economicTradingPnl: string;
  feesPaid: string;
  fees: string;
  settlementAdjustment: string;
  cashTradingPnl: string;
  unrealizedPnl: string;
  currentUnrealizedPnl: string;
  valuationStatus: string;
};

export type PublicPortfolioClosedTradeSummary = {
  closedPositionCount: number;
  winCount: number;
  lossCount: number;
  winRatePct: string;
};

export type PublicMemberPortfolio = {
  memberId: number;
  accountExists: boolean;
  roundId: number | null;
  roundNumber: number;
  initialSeed: string;
  wallet: PublicPortfolioWallet;
  allocation: PublicPortfolioAllocation;
  positions: PublicPortfolioPositionItem[];
  symbolPerformances: PublicPortfolioSymbolPerformance[];
  closedTradeSummary: PublicPortfolioClosedTradeSummary;
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
  const authorProfileImgUrl = authorWithdrawn ? null : optStr(row.authorProfileImgUrl, 1000);
  return {
    id: posInt(row.id),
    memberId: posInt(row.memberId),
    authorNickname,
    ...(row.authorProfileImgUrl !== undefined ? { authorProfileImgUrl } : {}),
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
  const authorProfileImgUrl = authorWithdrawn ? null : optStr(row.authorProfileImgUrl, 1000);
  const deleted = typeof row.deleted === "boolean" ? row.deleted : false;
  return {
    id: posInt(row.id),
    postId: posInt(row.postId),
    memberId: posInt(row.memberId),
    authorNickname,
    ...(row.authorProfileImgUrl !== undefined ? { authorProfileImgUrl } : {}),
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
  return {
    items: row.items.map(parseCommunityComment),
    hasNext: typeof row.hasNext === "boolean" ? row.hasNext : false,
    nextCursorId:
      row.nextCursorId === null || row.nextCursorId === undefined
        ? null
        : posInt(row.nextCursorId),
  };
}

export function parseMemberCommunityCommentItem(value: unknown): MemberCommunityCommentItem {
  const row = obj(value);
  const authorWithdrawn = typeof row.authorWithdrawn === "boolean" ? row.authorWithdrawn : false;
  const authorNickname = authorWithdrawn
    ? "탈퇴한회원"
    : typeof row.authorNickname === "string" && row.authorNickname.length > 0
      ? str(row.authorNickname, 40)
      : "회원";
  const authorProfileImgUrl = authorWithdrawn ? null : optStr(row.authorProfileImgUrl, 1000);
  return {
    id: posInt(row.id),
    postId: posInt(row.postId),
    postTitle: typeof row.postTitle === "string" && row.postTitle.length > 0 ? str(row.postTitle, 300) : "게시글",
    postCategory: typeof row.postCategory === "string" && row.postCategory.length > 0 ? str(row.postCategory, 20) : "FREE",
    postSymbolTag: optStr(row.postSymbolTag, 20),
    memberId: typeof row.memberId === "number" ? posInt(row.memberId) : 1,
    authorNickname,
    ...(row.authorProfileImgUrl !== undefined ? { authorProfileImgUrl } : {}),
    authorWithdrawn,
    parentCommentId:
      row.parentCommentId === null || row.parentCommentId === undefined
        ? null
        : posInt(row.parentCommentId),
    targetCommentId:
      row.targetCommentId === null || row.targetCommentId === undefined
        ? null
        : posInt(row.targetCommentId),
    targetMemberId:
      row.targetMemberId === null || row.targetMemberId === undefined
        ? null
        : posInt(row.targetMemberId),
    targetNickname: optStr(row.targetNickname, 40),
    content: str(row.content, 2000),
    likeCount: typeof row.likeCount === "number" ? nonNegInt(row.likeCount) : 0,
    reportCount: typeof row.reportCount === "number" ? nonNegInt(row.reportCount) : 0,
    likedByMe: typeof row.likedByMe === "boolean" ? row.likedByMe : false,
    reportedByMe: typeof row.reportedByMe === "boolean" ? row.reportedByMe : false,
    mine: typeof row.mine === "boolean" ? row.mine : false,
    createdAt: iso(row.createdAt),
    updatedAt: typeof row.updatedAt === "string" && Number.isFinite(Date.parse(row.updatedAt)) ? row.updatedAt : iso(row.createdAt),
  };
}

export function parseMemberCommunityCommentPage(value: unknown): MemberCommunityCommentPage {
  const row = obj(value);
  if (!Array.isArray(row.items) || typeof row.hasNext !== "boolean") return fail();
  return {
    items: row.items.map(parseMemberCommunityCommentItem),
    hasNext: row.hasNext,
    nextCursorId:
      row.nextCursorId === null || row.nextCursorId === undefined
        ? null
        : posInt(row.nextCursorId),
  };
}

export function parseMemberCommunityReportItem(value: unknown): MemberCommunityReportItem {
  const row = obj(value);
  const rawType = row.targetType;
  if (rawType !== "POST" && rawType !== "COMMENT") return fail();
  const titleText =
    typeof row.title === "string" && row.title.length > 0
      ? str(row.title, 2000)
      : typeof row.postTitle === "string" && row.postTitle.length > 0
        ? str(row.postTitle, 2000)
        : typeof row.targetPreview === "string" && row.targetPreview.length > 0
          ? str(row.targetPreview, 2000)
          : "신고 대상";
  const previewText =
    typeof row.targetPreview === "string" && row.targetPreview.length > 0
      ? str(row.targetPreview, 2000)
      : titleText;
  const reasonDesc =
    typeof row.reasonDescription === "string" && row.reasonDescription.length > 0
      ? str(row.reasonDescription, 300)
      : typeof row.reason === "string" && row.reason.length > 0
        ? str(row.reason, 300)
        : "기타";
  return {
    id: posInt(row.id),
    targetType: rawType,
    targetId: posInt(row.targetId),
    postId: typeof row.postId === "number" ? posInt(row.postId) : posInt(row.targetId),
    title: titleText,
    postTitle: typeof row.postTitle === "string" && row.postTitle.length > 0 ? str(row.postTitle, 300) : titleText,
    targetPreview: previewText,
    reasonType: typeof row.reasonType === "string" && row.reasonType.length > 0 ? str(row.reasonType, 60) : "SPAM",
    reasonDescription: reasonDesc,
    reason: reasonDesc,
    status: typeof row.status === "string" && row.status.length > 0 ? str(row.status, 40) : "RECEIVED",
    createdAt: iso(row.createdAt),
  };
}

export function parseMemberCommunityReportPage(value: unknown): MemberCommunityReportPage {
  const row = obj(value);
  if (!Array.isArray(row.items) || typeof row.hasNext !== "boolean") return fail();
  return {
    items: row.items.map(parseMemberCommunityReportItem),
    hasNext: row.hasNext,
    nextCursorId:
      row.nextCursorId === null || row.nextCursorId === undefined
        ? null
        : posInt(row.nextCursorId),
  };
}

export function parsePublicMemberPortfolio(value: unknown): PublicMemberPortfolio {
  const row = obj(value);
  const w = row.wallet && typeof row.wallet === "object" ? (row.wallet as Record<string, unknown>) : {};
  const a = row.allocation && typeof row.allocation === "object" ? (row.allocation as Record<string, unknown>) : {};
  const c =
    row.closedTradeSummary && typeof row.closedTradeSummary === "object"
      ? (row.closedTradeSummary as Record<string, unknown>)
      : {};
  const strOrZero = (v: unknown): string =>
    typeof v === "string" && v.length > 0 ? v : typeof v === "number" ? String(v) : "0";
  const rawPositions = Array.isArray(row.positions) ? row.positions : [];
  const rawSymbols = Array.isArray(row.symbolPerformances) ? row.symbolPerformances : [];
  return {
    memberId: posInt(row.memberId),
    accountExists: typeof row.accountExists === "boolean" ? row.accountExists : false,
    roundId: row.roundId === null || row.roundId === undefined ? null : posInt(row.roundId),
    roundNumber: typeof row.roundNumber === "number" ? nonNegInt(row.roundNumber) : 0,
    initialSeed: strOrZero(row.initialSeed ?? "10000"),
    wallet: {
      balance: strOrZero(w.balance),
      availableBalance: strOrZero(w.availableBalance),
      usedMargin: strOrZero(w.usedMargin),
      reservedMargin: strOrZero(w.reservedMargin),
      totalEquity: strOrZero(w.totalEquity),
      unrealizedPnl: strOrZero(w.unrealizedPnl),
      realizedPnl: strOrZero(w.realizedPnl),
      totalPnl: strOrZero(w.totalPnl),
      totalRoiPct: strOrZero(w.totalRoiPct),
      priceFresh: typeof w.priceFresh === "boolean" ? w.priceFresh : true,
    },
    allocation: {
      usedMarginRatioPct: strOrZero(a.usedMarginRatioPct),
      availableCashRatioPct: strOrZero(a.availableCashRatioPct),
      longMarginUsdt: strOrZero(a.longMarginUsdt),
      shortMarginUsdt: strOrZero(a.shortMarginUsdt),
      longRatioPct: strOrZero(a.longRatioPct),
      shortRatioPct: strOrZero(a.shortRatioPct),
      longPositionCount: typeof a.longPositionCount === "number" ? nonNegInt(a.longPositionCount) : 0,
      shortPositionCount: typeof a.shortPositionCount === "number" ? nonNegInt(a.shortPositionCount) : 0,
    },
    positions: rawPositions.map(item => {
      const p = obj(item);
      const side = p.side === "SHORT" ? "SHORT" : "LONG";
      return {
        id: typeof p.id === "number" ? posInt(p.id) : 1,
        symbol: strOrZero(p.symbol),
        tradingSymbolId: p.tradingSymbolId === null || p.tradingSymbolId === undefined ? null : posInt(p.tradingSymbolId),
        side,
        leverage: typeof p.leverage === "number" ? posInt(p.leverage) : 1,
        quantity: strOrZero(p.quantity),
        entryPrice: strOrZero(p.entryPrice),
        markPrice: strOrZero(p.markPrice),
        liquidationPrice: strOrZero(p.liquidationPrice),
        margin: strOrZero(p.margin),
        unrealizedPnl: strOrZero(p.unrealizedPnl),
        roePct: strOrZero(p.roePct),
        marginRatioPct: strOrZero(p.marginRatioPct),
      };
    }),
    symbolPerformances: rawSymbols.map(item => {
      const s = obj(item);
      return {
        tradingSymbolId: s.tradingSymbolId === null || s.tradingSymbolId === undefined ? null : posInt(s.tradingSymbolId),
        symbol: strOrZero(s.symbol),
        quoteAsset: typeof s.quoteAsset === "string" && s.quoteAsset.length > 0 ? s.quoteAsset : "USDT",
        fillCount: typeof s.fillCount === "number" ? nonNegInt(s.fillCount) : 0,
        executedNotional: strOrZero(s.executedNotional),
        turnover: strOrZero(s.turnover),
        turnoverSharePercent: strOrZero(s.turnoverSharePercent),
        realizedPnl: strOrZero(s.realizedPnl),
        grossRealizedPnl: strOrZero(s.grossRealizedPnl),
        economicPnl: strOrZero(s.economicPnl),
        economicTradingPnl: strOrZero(s.economicTradingPnl),
        feesPaid: strOrZero(s.feesPaid),
        fees: strOrZero(s.fees),
        settlementAdjustment: strOrZero(s.settlementAdjustment),
        cashTradingPnl: strOrZero(s.cashTradingPnl),
        unrealizedPnl: strOrZero(s.unrealizedPnl),
        currentUnrealizedPnl: strOrZero(s.currentUnrealizedPnl),
        valuationStatus: typeof s.valuationStatus === "string" ? s.valuationStatus : "FRESH",
      };
    }),
    closedTradeSummary: {
      closedPositionCount: typeof c.closedPositionCount === "number" ? nonNegInt(c.closedPositionCount) : 0,
      winCount: typeof c.winCount === "number" ? nonNegInt(c.winCount) : 0,
      lossCount: typeof c.lossCount === "number" ? nonNegInt(c.lossCount) : 0,
      winRatePct: strOrZero(c.winRatePct),
    },
  };
}

export function communityCommentsPath(postId: number, cursorId?: number | null, size = 20): string {
  const search = new URLSearchParams();
  if (cursorId) search.set("cursorId", String(cursorId));
  search.set("size", String(size));
  const query = search.toString();
  return `/community/posts/${postId}/comments${query ? `?${query}` : ""}`;
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
