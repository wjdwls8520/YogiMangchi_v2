"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMember } from "./member-provider";
import { MemberShell } from "./member-views";
import { DimModal } from "./dim-modal";
import { contentJson, contentMessage, contentOrigin } from "../api/client";
import {
  NEWS_CATEGORIES,
  SYMBOL_FILTER_TAGS,
  newsCategoryLabel,
  newsPath,
  parseNewsHighlights,
  parseNewsItem,
  parseNewsLiveStatus,
  parseNewsPage,
  parseNewsReaction,
  type NewsCategory,
  type NewsHighlights,
  type NewsItem,
  type NewsLiveStatus,
  type NewsPage,
  type NewsSort,
} from "../api/community-news";

function kst(value: string) {
  return new Date(value).toLocaleString("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function kstTimeOnly(value: string) {
  return new Date(value).toLocaleTimeString("sv-SE", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

const BREAKING_MUST_READ = [
  {
    id: 901,
    title: "美 나스닥 지수 장중 2%대 상승",
    timeAgo: "31분 전",
    badge: null as string | null,
  },
  {
    id: 902,
    title: '"美 암호화폐 규제 지연, 토큰화 기업 해외 진출 가속화"',
    timeAgo: "56분 전",
    badge: null as string | null,
  },
  {
    id: 903,
    title: "유럽 37개 금융기관, 유로화 스테이블코인 공동 발행 추진",
    timeAgo: "48분 전",
    badge: "XRP -2.6%",
  },
] as const;

const POPULAR_BREAKING_BY_QUOTE = [
  { rank: 1, title: '트럼프 "UAE의 WLFI 투자 관련 아는 바 없어...아들들이 처리"', timeAgo: "7시간 전" },
  { rank: 2, title: "BTC $75,000 상회 · 선물 미결제약정 동반 급증", timeAgo: "18시간 전" },
  { rank: 3, title: '트럼프 "가족 암호화폐 사업 상황 잘 몰라...중단 요구 못해"', timeAgo: "14시간 전" },
  { rank: 4, title: "BTC $74,000 단기 지지선 테스트 후 반등 시도", timeAgo: "10시간 전" },
] as const;

const POPULAR_BREAKING_BY_REACTION = [
  { rank: 1, title: "비트코인 현물 ETF 일일 순유입 5억 달러 돌파", timeAgo: "3시간 전" },
  { rank: 2, title: "미 연준 금리 동결 시사 및 기술주 중심 위험자산 강세", timeAgo: "5시간 전" },
  { rank: 3, title: "솔라나(SOL) DEX 일간 거래량 사상 최고치 경신", timeAgo: "9시간 전" },
  { rank: 4, title: "이더리움 레이어2 스테이블코인 시가총액 140억 달러 돌파", timeAgo: "12시간 전" },
] as const;

const KEYWORD_ISSUES = [
  {
    tag: "#클래리티법",
    headline: '"美 암호화폐 규제 지연, 토큰화 기업 해외 진출 가속화"',
    timeAgo: "56분 전",
  },
  {
    tag: "#현물ETF",
    headline: '"블랙록·피델리티 비트코인 현물 ETF 기관 순유입세 지속"',
    timeAgo: "1시간 전",
  },
  {
    tag: "#FOMC금리",
    headline: '"미 국채 금리 안정세 속 나스닥·가상자산 동반 반등"',
    timeAgo: "2시간 전",
  },
] as const;

function parseUrlTabState(search: string): {
  section?: "BREAKING" | "NEWSROOM";
  breakingSub?: "ALL" | "COIN" | "ECONOMY";
  breakingSort?: "LATEST" | "OLDEST";
  newsroomSub?: "ALL" | "CRYPTO" | "STOCKS" | "FX_RATES";
  newsroomSort?: NewsSort;
} {
  const params = new URLSearchParams(search);
  const tab = params.get("tab")?.toLowerCase();
  const sub = params.get("sub")?.toLowerCase();
  const sort = params.get("sort")?.toLowerCase();

  const section =
    tab === "newsroom" ? "NEWSROOM" : tab === "breaking" ? "BREAKING" : undefined;
  const breakingSub =
    sub === "economy"
      ? "ECONOMY"
      : sub === "coin"
        ? "COIN"
        : sub === "all"
          ? "ALL"
          : undefined;
  const breakingSort =
    sort === "oldest" ? "OLDEST" : sort === "latest" ? "LATEST" : undefined;
  const newsroomSub =
    sub === "crypto"
      ? "CRYPTO"
      : sub === "stocks"
        ? "STOCKS"
        : sub === "fx" || sub === "fx_rates"
          ? "FX_RATES"
          : sub === "all"
            ? "ALL"
            : undefined;
  const newsroomSort =
    sort === "popular"
      ? "POPULAR"
      : sort === "oldest"
        ? "OLDEST"
        : sort === "latest"
          ? "LATEST"
          : undefined;
  return { section, breakingSub, breakingSort, newsroomSub, newsroomSort };
}

function buildNewsUrlQuery(
  sectionTab: "BREAKING" | "NEWSROOM",
  breakingSubTab: "ALL" | "COIN" | "ECONOMY",
  breakingSort: "LATEST" | "OLDEST",
  newsroomTab: "ALL" | "CRYPTO" | "STOCKS" | "FX_RATES",
  newsroomSort: NewsSort,
): string {
  const params = new URLSearchParams();
  if (sectionTab === "NEWSROOM") {
    params.set("tab", "newsroom");
    const subMap: Record<"ALL" | "CRYPTO" | "STOCKS" | "FX_RATES", string> = {
      ALL: "all",
      CRYPTO: "crypto",
      STOCKS: "stocks",
      FX_RATES: "fx",
    };
    params.set("sub", subMap[newsroomTab]);
    params.set(
      "sort",
      newsroomSort === "POPULAR"
        ? "popular"
        : newsroomSort === "OLDEST"
          ? "oldest"
          : "latest",
    );
  } else {
    params.set("tab", "breaking");
    params.set(
      "sub",
      breakingSubTab === "ECONOMY" ? "economy" : breakingSubTab === "COIN" ? "coin" : "all",
    );
    params.set("sort", breakingSort === "OLDEST" ? "oldest" : "latest");
  }
  return `?${params.toString()}`;
}

function isEconomyBreakingItem(item: NewsItem): boolean {
  return (
    item.subCategory === "ECONOMY_FLASH" ||
    item.subCategory === "STOCKS" ||
    item.subCategory === "FX_RATES" ||
    item.category === "MACRO" ||
    item.category === "REGULATION"
  );
}

function isCoinBreakingItem(item: NewsItem): boolean {
  return !isEconomyBreakingItem(item);
}

function sortNewsItems(items: NewsItem[], sort: NewsSort): NewsItem[] {
  return [...items].sort((a, b) => {
    const timeA = Number.isNaN(Date.parse(a.publishedAt)) ? 0 : Date.parse(a.publishedAt);
    const timeB = Number.isNaN(Date.parse(b.publishedAt)) ? 0 : Date.parse(b.publishedAt);
    if (sort === "OLDEST") {
      return timeA - timeB || a.id - b.id;
    }
    if (sort === "POPULAR") {
      const scoreA = (a.bullCount ?? 0) + (a.bearCount ?? 0) + (a.viewCount ?? 0);
      const scoreB = (b.bullCount ?? 0) + (b.bearCount ?? 0) + (b.viewCount ?? 0);
      return scoreB - scoreA || timeB - timeA || b.id - a.id;
    }
    return timeB - timeA || b.id - a.id;
  });
}

function orderNewsWithPrependedFirst(
  items: NewsItem[],
  prependedIds: Set<number>,
  sort: NewsSort,
): NewsItem[] {
  if (sort !== "LATEST" || prependedIds.size === 0) {
    return sortNewsItems(items, sort);
  }
  const prepended: NewsItem[] = [];
  const rest: NewsItem[] = [];
  for (const item of items) {
    if (prependedIds.has(item.id)) {
      prepended.push(item);
    } else {
      rest.push(item);
    }
  }
  return [...prepended, ...sortNewsItems(rest, "LATEST")];
}

function cleanBreakingBody(content: string, summary: string, aiSummary?: string | null): string {
  const withoutFooter = content.split(/\n*\s*\[출처:/)[0]?.trim() ?? "";
  const lines = withoutFooter
    .split(/\n+/)
    .map(line => line.trim())
    .filter(
      line =>
        line.length > 0 &&
        line !== summary.trim() &&
        line !== (aiSummary ?? "").trim() &&
        !line.startsWith("✦ AI"),
    );
  return lines.join(" ");
}

function cleanNewsroomExcerpt(
  summary: string,
  content: string,
  aiSummary?: string | null,
): string {
  const extra = cleanBreakingBody(content, summary, aiSummary);
  return extra ? `${summary} ${extra}` : summary;
}

function newsroomSubHashtag(item: NewsItem): string {
  if (item.subCategory === "STOCKS") return "#해외증시";
  if (item.subCategory === "FX_RATES") return "#환율·금리";
  if (item.category === "MACRO") return "#거시경제";
  if (item.category === "REGULATION") return "#규제·정책";
  return "#암호화폐";
}

export function NewsFeed({
  initialPage,
  initialHighlights,
  initialCategory = "",
  initialSymbolTag = "",
  initialSection,
  initialBreakingSubTab,
  initialBreakingSort,
  initialNewsroomTab,
  initialNewsroomSort,
  initialPendingNewNewsCount = 0,
  initialPendingCoinCount,
  initialPendingEconomyCount,
  initialLiveActive,
}: {
  initialPage?: NewsPage;
  initialHighlights?: NewsHighlights;
  initialCategory?: "" | NewsCategory;
  initialSymbolTag?: string;
  initialSection?: "BREAKING" | "NEWSROOM";
  initialBreakingSubTab?: "ALL" | "COIN" | "ECONOMY";
  initialBreakingSort?: "LATEST" | "OLDEST";
  initialNewsroomTab?: "ALL" | "CRYPTO" | "STOCKS" | "FX_RATES";
  initialNewsroomSort?: NewsSort;
  initialPendingNewNewsCount?: number;
  initialPendingCoinCount?: number;
  initialPendingEconomyCount?: number;
  initialLiveActive?: boolean;
} = {}) {
  const { origin, snapshot } = useMember();
  const queryClient = useQueryClient();
  const accountStorageKey =
    snapshot.phase === "ready" && snapshot.memberId
      ? `yogimangchi:news-unread:v1:member:${snapshot.memberId}`
      : "yogimangchi:news-unread:v1:anonymous";

  const [sectionTab, setSectionTab] = useState<"BREAKING" | "NEWSROOM">(() => {
    if (initialSection) return initialSection;
    if (typeof window !== "undefined") {
      return parseUrlTabState(window.location.search).section ?? "BREAKING";
    }
    return "BREAKING";
  });
  const [breakingSubTab, setBreakingSubTab] = useState<"ALL" | "COIN" | "ECONOMY">(() => {
    if (initialBreakingSubTab) return initialBreakingSubTab;
    if (typeof window !== "undefined") {
      return parseUrlTabState(window.location.search).breakingSub ?? "ALL";
    }
    return "ALL";
  });
  const [breakingSort, setBreakingSort] = useState<"LATEST" | "OLDEST">(() => {
    if (initialBreakingSort) return initialBreakingSort;
    if (typeof window !== "undefined") {
      return parseUrlTabState(window.location.search).breakingSort ?? "LATEST";
    }
    return "LATEST";
  });
  const [popularMode, setPopularMode] = useState<"QUOTE" | "REACTION">("QUOTE");
  const [issueIndex, setIssueIndex] = useState(0);
  const [quickChip, setQuickChip] = useState<"" | "WATCH" | "MENTION" | "VOLUME">("");

  const [newsroomTab, setNewsroomTab] = useState<"ALL" | "CRYPTO" | "STOCKS" | "FX_RATES">(() => {
    if (initialNewsroomTab) return initialNewsroomTab;
    if (typeof window !== "undefined") {
      return parseUrlTabState(window.location.search).newsroomSub ?? "ALL";
    }
    return "ALL";
  });
  const [newsroomSort, setNewsroomSort] = useState<NewsSort>(() => {
    if (initialNewsroomSort) return initialNewsroomSort;
    if (typeof window !== "undefined") {
      return parseUrlTabState(window.location.search).newsroomSort ?? "LATEST";
    }
    return "LATEST";
  });

  const [viewMode, setViewMode] = useState<"ALL" | "HEADLINE">("ALL");
  const [category, setCategory] = useState<"" | NewsCategory>(initialCategory);
  const [symbolTag, setSymbolTag] = useState<string>(initialSymbolTag);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [extraItems, setExtraItems] = useState<NewsItem[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null | undefined>(undefined);
  const [hasNextOverride, setHasNextOverride] = useState<boolean | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState<NewsItem | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [reactions, setReactions] = useState<Record<number, "bull" | "bear">>({});
  const [liveReactions, setLiveReactions] = useState<
    Record<number, { bullCount: number; bearCount: number }>
  >({});
  const [failedThumbIds, setFailedThumbIds] = useState<Record<number, boolean>>({});
  const [sseConnected, setSseConnected] = useState<boolean | null>(null);
  const [sseError, setSseError] = useState(false);
  const [sseLiveStatus, setSseLiveStatus] = useState<NewsLiveStatus | null>(null);

  // 실시간 SSE 속보 토스트, 탭별 미확인 카운트(전체/코인/경제) 및 무한스크롤 센티넬 상태
  const feedTopRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const hasInitialCountOverride =
    initialPendingCoinCount !== undefined ||
    initialPendingEconomyCount !== undefined ||
    initialPendingNewNewsCount > 0;

  const initialCoinIds =
    initialPendingCoinCount !== undefined
      ? Array.from({ length: initialPendingCoinCount }, (_, idx) => -(idx + 1))
      : initialPendingNewNewsCount > 0 && initialBreakingSubTab !== "ECONOMY"
        ? Array.from({ length: initialPendingNewNewsCount }, (_, idx) => -(idx + 1))
        : [];
  const initialEconomyIds =
    initialPendingEconomyCount !== undefined
      ? Array.from({ length: initialPendingEconomyCount }, (_, idx) => -(1000 + idx + 1))
      : initialPendingNewNewsCount > 0 && initialBreakingSubTab === "ECONOMY"
        ? Array.from({ length: initialPendingNewNewsCount }, (_, idx) => -(1000 + idx + 1))
        : [];

  const [unreadByAccount, setUnreadByAccount] = useState<
    Record<string, { coinIds: number[]; economyIds: number[] }>
  >(() =>
    hasInitialCountOverride
      ? { [accountStorageKey]: { coinIds: initialCoinIds, economyIds: initialEconomyIds } }
      : {},
  );
  const [pendingNewsroomCount, setPendingNewsroomCount] = useState<number>(
    initialSection === "NEWSROOM" ? initialPendingNewNewsCount : 0,
  );
  const [prependedNews, setPrependedNews] = useState<NewsItem[]>([]);
  const incomingNewsRef = useRef<NewsItem[]>([]);
  const accountStorageKeyRef = useRef<string>(accountStorageKey);

  useEffect(() => {
    accountStorageKeyRef.current = accountStorageKey;
  }, [accountStorageKey]);

  const readStoredUnread = (
    storageKey: string,
  ): { coinIds: number[]; economyIds: number[] } => {
    if (
      typeof window === "undefined" ||
      hasInitialCountOverride ||
      typeof window.localStorage?.getItem !== "function"
    ) {
      return { coinIds: initialCoinIds, economyIds: initialEconomyIds };
    }
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return { coinIds: [], economyIds: [] };
      const parsed = JSON.parse(raw) as {
        coinIds?: unknown;
        economyIds?: unknown;
      };
      const coinIds = Array.isArray(parsed.coinIds)
        ? parsed.coinIds.filter((id): id is number => typeof id === "number")
        : [];
      const economyIds = Array.isArray(parsed.economyIds)
        ? parsed.economyIds.filter((id): id is number => typeof id === "number")
        : [];
      return { coinIds, economyIds };
    } catch {
      return { coinIds: [], economyIds: [] };
    }
  };

  const currentAccountUnread =
    unreadByAccount[accountStorageKey] ?? readStoredUnread(accountStorageKey);
  const pendingCoinIds = currentAccountUnread.coinIds;
  const pendingEconomyIds = currentAccountUnread.economyIds;

  function updateAccountUnread(
    updater: (prev: { coinIds: number[]; economyIds: number[] }) => {
      coinIds: number[];
      economyIds: number[];
    },
  ) {
    setUnreadByAccount(prevMap => {
      const key = accountStorageKeyRef.current;
      const base = prevMap[key] ?? readStoredUnread(key);
      const next = updater(base);
      return { ...prevMap, [key]: next };
    });
  }

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      hasInitialCountOverride ||
      typeof window.localStorage?.getItem !== "function"
    ) {
      return;
    }
    try {
      const raw = window.localStorage.getItem(accountStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { items?: unknown };
      if (Array.isArray(parsed.items)) {
        const bufferedItems: NewsItem[] = [];
        for (const rawItem of parsed.items) {
          try {
            bufferedItems.push(parseNewsItem(rawItem));
          } catch {
            // Ignore invalid cached item
          }
        }
        for (const item of bufferedItems) {
          if (!incomingNewsRef.current.some(existing => existing.id === item.id)) {
            incomingNewsRef.current.push(item);
          }
        }
      }
    } catch {
      // Ignore storage read errors
    }
  }, [accountStorageKey, hasInitialCountOverride]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      hasInitialCountOverride ||
      typeof window.localStorage?.setItem !== "function"
    ) {
      return;
    }
    if (!(accountStorageKey in unreadByAccount)) return;
    try {
      const activeIds = new Set([...pendingCoinIds, ...pendingEconomyIds]);
      const itemsToKeep = incomingNewsRef.current
        .filter(item => activeIds.has(item.id))
        .slice(0, 30);
      window.localStorage.setItem(
        accountStorageKey,
        JSON.stringify({
          coinIds: pendingCoinIds,
          economyIds: pendingEconomyIds,
          items: itemsToKeep,
        }),
      );
    } catch {
      // Ignore storage quota errors
    }
  }, [accountStorageKey, unreadByAccount, pendingCoinIds, pendingEconomyIds, hasInitialCountOverride]);

  const coinUnreadCount = pendingCoinIds.length;
  const economyUnreadCount = pendingEconomyIds.length;
  const allUnreadCount = coinUnreadCount + economyUnreadCount;
  const activeToastCount =
    sectionTab === "BREAKING"
      ? breakingSubTab === "COIN"
        ? coinUnreadCount
        : breakingSubTab === "ECONOMY"
          ? economyUnreadCount
          : allUnreadCount
      : pendingNewsroomCount || allUnreadCount;

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.history?.replaceState !== "function") {
      return;
    }
    const nextQuery = buildNewsUrlQuery(
      sectionTab,
      breakingSubTab,
      breakingSort,
      newsroomTab,
      newsroomSort,
    );
    if (window.location.search !== nextQuery) {
      const nextUrl = `${window.location.pathname || "/news"}${nextQuery}`;
      window.history.replaceState(null, "", nextUrl);
    }
  }, [sectionTab, breakingSubTab, breakingSort, newsroomTab, newsroomSort]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPopState = () => {
      const parsed = parseUrlTabState(window.location.search);
      if (parsed.section) setSectionTab(parsed.section);
      if (parsed.breakingSub) setBreakingSubTab(parsed.breakingSub);
      if (parsed.breakingSort) setBreakingSort(parsed.breakingSort);
      if (parsed.newsroomSub) setNewsroomTab(parsed.newsroomSub);
      if (parsed.newsroomSort) setNewsroomSort(parsed.newsroomSort);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const activeSort: NewsSort = sectionTab === "NEWSROOM" ? newsroomSort : breakingSort;
  const effectiveSort: NewsSort | undefined = activeSort === "LATEST" ? undefined : activeSort;

  const query = useQuery({
    queryKey: ["public-news", origin, category, symbolTag, submittedKeyword, effectiveSort],
    initialData:
      initialPage &&
      category === initialCategory &&
      symbolTag === initialSymbolTag &&
      !submittedKeyword &&
      !effectiveSort
        ? initialPage
        : undefined,
    queryFn: async ({ signal }) =>
      parseNewsPage(
        await contentJson(
          origin,
          newsPath({
            category,
            symbolTag,
            keyword: submittedKeyword,
            sort: effectiveSort,
            size: 10,
          }),
          { signal },
        ),
      ),
  });

  const highlightsQuery = useQuery({
    queryKey: ["public-news-highlights", origin],
    initialData: initialHighlights,
    staleTime: 30_000,
    queryFn: async ({ signal }) =>
      parseNewsHighlights(await contentJson(origin, "/news/highlights", { signal })),
  });

  function resetPagination() {
    setExtraItems([]);
    setNextCursor(undefined);
    setHasNextOverride(undefined);
  }

  const baseItems = query.data?.items ?? [];
  const prependedIdSet = new Set(prependedNews.map(item => item.id));
  const allItems = (() => {
    const seen = new Set<number>();
    const merged: NewsItem[] = [];
    for (const item of [...prependedNews, ...baseItems, ...extraItems]) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        merged.push(item);
      }
    }
    return orderNewsWithPrependedFirst(merged, prependedIdSet, activeSort);
  })();

  const retentionHours = highlightsQuery.data?.liveStatus?.retentionHours ?? 6;
  const referenceNowMs = (() => {
    const collectedRaw = highlightsQuery.data?.liveStatus?.lastCollectedAt;
    const collectedMs = collectedRaw ? Date.parse(collectedRaw) : Number.NaN;
    const maxItemMs = allItems.reduce((acc, item) => {
      const ts = Date.parse(item.publishedAt);
      return Number.isNaN(ts) ? acc : Math.max(acc, ts);
    }, 0);
    return !Number.isNaN(collectedMs) ? Math.max(collectedMs, maxItemMs) : maxItemMs;
  })();

  // 서브탭 필터링 (결과가 비어있으면 전체 항목 fallback)
  const subFilteredItems = (() => {
    if (sectionTab === "BREAKING") {
      const cutoffMs =
        referenceNowMs > 0 ? referenceNowMs - retentionHours * 60 * 60 * 1000 : 0;
      const recentItems = allItems.filter(item => {
        if (prependedIdSet.has(item.id)) return true;
        const ts = Date.parse(item.publishedAt);
        return Number.isNaN(ts) || ts >= cutoffMs;
      });
      const pool = recentItems.length > 0 ? recentItems : allItems;
      if (breakingSubTab === "COIN") {
        const matched = pool.filter(isCoinBreakingItem);
        return orderNewsWithPrependedFirst(
          matched.length > 0 ? matched : pool,
          prependedIdSet,
          activeSort,
        );
      }
      if (breakingSubTab === "ECONOMY") {
        const matched = pool.filter(isEconomyBreakingItem);
        return orderNewsWithPrependedFirst(
          matched.length > 0 ? matched : pool,
          prependedIdSet,
          activeSort,
        );
      }
      return orderNewsWithPrependedFirst(pool, prependedIdSet, activeSort);
    }
    if (newsroomTab === "CRYPTO") {
      const matched = allItems.filter(
        item =>
          item.subCategory === "CRYPTO" ||
          item.category === "CRYPTO" ||
          item.category === "ONCHAIN",
      );
      return orderNewsWithPrependedFirst(
        matched.length > 0 ? matched : allItems,
        prependedIdSet,
        activeSort,
      );
    }
    if (newsroomTab === "STOCKS" || newsroomTab === "FX_RATES") {
      const matched = allItems.filter(
        item =>
          item.subCategory === newsroomTab ||
          item.category === "MACRO" ||
          item.category === "REGULATION",
      );
      return orderNewsWithPrependedFirst(
        matched.length > 0 ? matched : allItems,
        prependedIdSet,
        activeSort,
      );
    }
    return orderNewsWithPrependedFirst(allItems, prependedIdSet, activeSort);
  })();

  const visibleItems =
    viewMode === "HEADLINE"
      ? subFilteredItems.filter((_, idx) => idx % 2 === 0 || subFilteredItems.length <= 2)
      : subFilteredItems;

  const hasNext = hasNextOverride ?? query.data?.hasNext ?? false;
  const cursorId = nextCursor !== undefined ? nextCursor : (query.data?.nextCursorId ?? null);

  async function loadMore() {
    if (!hasNext || !cursorId || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = parseNewsPage(
        await contentJson(
          origin,
          newsPath({
            category,
            symbolTag,
            keyword: submittedKeyword,
            sort: effectiveSort,
            cursorId,
            size: 10,
          }),
        ),
      );
      setExtraItems(current => [...current, ...page.items]);
      setNextCursor(page.nextCursorId);
      setHasNextOverride(page.hasNext);
    } catch (error) {
      setDetailError(contentMessage(error));
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined" || !hasNext || !cursorId) return;
    const node = loadMoreSentinelRef.current;
    if (!node || typeof window.IntersectionObserver !== "function") return;
    const observer = new window.IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          void loadMore();
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.EventSource !== "function") return;
    let es: EventSource | null = null;
    try {
      es = new window.EventSource(`${contentOrigin(origin)}/api/v1/news/stream`);
      es.onopen = () => {
        setSseConnected(true);
        setSseError(false);
      };
      es.onerror = () => {
        setSseConnected(false);
        setSseError(true);
      };
      const onConnected = (event: MessageEvent) => {
        setSseConnected(true);
        setSseError(false);
        try {
          const parsed = JSON.parse(String(event.data ?? "{}"));
          if (parsed && typeof parsed === "object" && "live" in parsed) {
            setSseLiveStatus(parseNewsLiveStatus(parsed));
          }
        } catch {
          // Ignore malformed frame
        }
      };
      const onLiveStatus = (event: MessageEvent) => {
        try {
          const parsed = parseNewsLiveStatus(JSON.parse(String(event.data ?? "{}")));
          setSseLiveStatus(parsed);
          setSseError(!parsed.live);
        } catch {
          // Ignore malformed frame
        }
      };
      const onNewsCreated = (event: MessageEvent) => {
        try {
          const parsed = parseNewsItem(JSON.parse(String(event.data ?? "{}")));
          if (category && parsed.category !== category) return;
          if (symbolTag && parsed.symbolTag !== symbolTag) return;
          if (!incomingNewsRef.current.some(item => item.id === parsed.id)) {
            incomingNewsRef.current = [parsed, ...incomingNewsRef.current];
          }
          if (isEconomyBreakingItem(parsed)) {
            setUnreadByAccount(prevMap => {
              const key = accountStorageKeyRef.current;
              const base = prevMap[key] ?? { coinIds: [], economyIds: [] };
              const nextEconomy = base.economyIds.includes(parsed.id)
                ? base.economyIds
                : [parsed.id, ...base.economyIds];
              return { ...prevMap, [key]: { ...base, economyIds: nextEconomy } };
            });
          } else {
            setUnreadByAccount(prevMap => {
              const key = accountStorageKeyRef.current;
              const base = prevMap[key] ?? { coinIds: [], economyIds: [] };
              const nextCoin = base.coinIds.includes(parsed.id)
                ? base.coinIds
                : [parsed.id, ...base.coinIds];
              return { ...prevMap, [key]: { ...base, coinIds: nextCoin } };
            });
          }
          if (parsed.section === "NEWSROOM") {
            setPendingNewsroomCount(prev => prev + 1);
          }
        } catch {
          setUnreadByAccount(prevMap => {
            const key = accountStorageKeyRef.current;
            const base = prevMap[key] ?? { coinIds: [], economyIds: [] };
            return {
              ...prevMap,
              [key]: { ...base, coinIds: [-(Date.now() + base.coinIds.length), ...base.coinIds] },
            };
          });
        }
      };
      const onReactionUpdated = (event: MessageEvent) => {
        try {
          const parsed = parseNewsReaction(JSON.parse(String(event.data ?? "{}")));
          setLiveReactions(prev => ({
            ...prev,
            [parsed.newsId]: {
              bullCount: parsed.bullCount,
              bearCount: parsed.bearCount,
            },
          }));
        } catch {
          // Ignore malformed reaction frame
        }
      };
      es.addEventListener("CONNECTED", onConnected as EventListener);
      es.addEventListener("NEWS_LIVE_STATUS", onLiveStatus as EventListener);
      es.addEventListener("NEWS_CREATED", onNewsCreated as EventListener);
      es.addEventListener("NEWS_REACTION_UPDATED", onReactionUpdated as EventListener);
    } catch {
      es = null;
    }
    return () => {
      if (es) es.close();
    };
  }, [origin, category, symbolTag]);

  function handleLoadNewNews() {
    if (sectionTab === "BREAKING" && breakingSubTab === "COIN") {
      const coinItems = incomingNewsRef.current.filter(isCoinBreakingItem);
      incomingNewsRef.current = incomingNewsRef.current.filter(isEconomyBreakingItem);
      if (coinItems.length > 0) {
        setPrependedNews(prev => {
          const existingIds = new Set([...prev, ...baseItems, ...extraItems].map(item => item.id));
          return [...coinItems.filter(item => !existingIds.has(item.id)), ...prev];
        });
      }
      updateAccountUnread(prev => ({ ...prev, coinIds: [] }));
    } else if (sectionTab === "BREAKING" && breakingSubTab === "ECONOMY") {
      const economyItems = incomingNewsRef.current.filter(isEconomyBreakingItem);
      incomingNewsRef.current = incomingNewsRef.current.filter(isCoinBreakingItem);
      if (economyItems.length > 0) {
        setPrependedNews(prev => {
          const existingIds = new Set([...prev, ...baseItems, ...extraItems].map(item => item.id));
          return [...economyItems.filter(item => !existingIds.has(item.id)), ...prev];
        });
      }
      updateAccountUnread(prev => ({ ...prev, economyIds: [] }));
    } else {
      if (incomingNewsRef.current.length > 0) {
        const fresh = incomingNewsRef.current;
        incomingNewsRef.current = [];
        setPrependedNews(prev => {
          const existingIds = new Set([...prev, ...baseItems, ...extraItems].map(item => item.id));
          return [...fresh.filter(item => !existingIds.has(item.id)), ...prev];
        });
      }
      updateAccountUnread(() => ({ coinIds: [], economyIds: [] }));
      setPendingNewsroomCount(0);
    }
    void query.refetch();
    void highlightsQuery.refetch();
    if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    feedTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function inspectArticle(id: number, fallback?: NewsItem) {
    setDetailError(null);
    try {
      const item = parseNewsItem(await contentJson(origin, `/news/${id}`));
      setSelectedDetail(item);
    } catch (error) {
      if (fallback) {
        setSelectedDetail(fallback);
      } else {
        setDetailError(contentMessage(error));
      }
    }
  }

  function toggleReaction(id: number, kind: "bull" | "bear") {
    setReactions(current => ({ ...current, [id]: kind }));
    void (async () => {
      try {
        const res = parseNewsReaction(
          await contentJson(origin, `/news/${id}/reactions`, {
            method: "POST",
            body: { reaction: kind === "bull" ? "BULL" : "BEAR" },
          }),
        );
        setLiveReactions(prev => ({
          ...prev,
          [id]: { bullCount: res.bullCount, bearCount: res.bearCount },
        }));
        void queryClient.invalidateQueries({ queryKey: ["public-news-highlights", origin] });
      } catch {
        // Keep optimistic local reaction state if offline or in test mock
      }
    })();
  }

  const highlights = highlightsQuery.data;

  const mustReadCards =
    highlights && highlights.mustReadBreaking.length > 0
      ? highlights.mustReadBreaking.slice(0, 3).map(item => ({
          id: item.id,
          title: item.title,
          timeAgo: `${kstTimeOnly(item.publishedAt)} KST`,
          badge: item.symbolTag ? `#${item.symbolTag}` : ( null as string | null ),
          item,
        }))
      : BREAKING_MUST_READ.map(card => ({ ...card, item: undefined as NewsItem | undefined }));

  const popularBreakingList = (() => {
    const serverList =
      popularMode === "QUOTE" ? highlights?.popularByViews : highlights?.popularByReactions;
    if (serverList && serverList.length > 0) {
      return serverList.slice(0, 4).map((item, idx) => ({
        rank: idx + 1,
        id: item.id,
        title: item.title,
        timeAgo: `${kstTimeOnly(item.publishedAt)} KST`,
        item,
      }));
    }
    const fallbackList =
      popularMode === "QUOTE" ? POPULAR_BREAKING_BY_QUOTE : POPULAR_BREAKING_BY_REACTION;
    return fallbackList.map(row => ({
      ...row,
      id: row.rank,
      item: undefined as NewsItem | undefined,
    }));
  })();

  const keywordIssueList =
    highlights && highlights.keywordIssues.length > 0
      ? highlights.keywordIssues.map(issue => ({
          tag: issue.keyword.startsWith("#") ? issue.keyword : `#${issue.keyword}`,
          headline: issue.articles[0]?.title ?? issue.label,
          timeAgo: issue.articles[0]
            ? `${kstTimeOnly(issue.articles[0].publishedAt)} KST`
            : `${issue.articleCount}건`,
        }))
      : KEYWORD_ISSUES;

  const activeIssue = keywordIssueList[issueIndex % keywordIssueList.length] ?? KEYWORD_ISSUES[0];

  const sentimentBullPct = highlights?.sentimentSummary.bullPct ?? 68;
  const sentimentBearPct = highlights?.sentimentSummary.bearPct ?? 32;

  const serverLiveStatus = sseLiveStatus ?? highlights?.liveStatus;
  const isLiveActive =
    initialLiveActive !== undefined
      ? initialLiveActive
      : sseError
        ? false
        : serverLiveStatus
          ? Boolean(serverLiveStatus.live && serverLiveStatus.collectorEnabled)
          : sseConnected !== false;

  return (
    <MemberShell
      title="실시간 뉴스"
      subtitle="글로벌 거시경제(연준 금리·물가·환율), 주요 암호화폐 시황, 온체인 수급 및 규제 동향을 실시간으로 확인하세요."
      variant="wide"
      hideCardHeading
    >
      <div className="mx-auto max-w-6xl lg:flex lg:items-start lg:gap-8">
        {/* 좌측 Aside: 속보 / 뉴스룸 메인 섹션 탭 네비게이션 */}
        <aside
          aria-label="실시간 뉴스 섹션 메뉴"
          className="mb-6 w-full shrink-0 space-y-4 lg:sticky lg:top-24 lg:mb-0 lg:w-56"
        >
          <div className="rounded-2xl border border-gray-200 bg-white p-3">
            <div className="mb-2 px-2 pt-1">
              <span className="text-[11px] font-extrabold tracking-wider text-gray-400 uppercase">
                NEWS DESK
              </span>
              <h2 className="text-base font-black text-gray-900">실시간 뉴스</h2>
            </div>

            <div className="space-y-1.5" role="tablist" aria-label="속보 및 뉴스룸 전환">
              <button
                type="button"
                role="tab"
                aria-selected={sectionTab === "BREAKING"}
                onClick={() => setSectionTab("BREAKING")}
                className={`flex w-full items-center justify-between rounded-xl px-3.5 py-3 text-left transition-colors ${
                  sectionTab === "BREAKING"
                    ? "bg-[#0058FF] text-white"
                    : "bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                <div>
                  <div className="flex items-center gap-2 text-sm font-black">
                    <span>⚡</span>
                    <span>속보</span>
                  </div>
                  <p
                    className={`mt-0.5 text-[11px] font-medium ${
                      sectionTab === "BREAKING" ? "text-blue-100" : "text-gray-400"
                    }`}
                  >
                    최근 6시간 실시간 속보
                  </p>
                </div>
                <span
                  data-live-status={isLiveActive ? "on" : "off"}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
                    isLiveActive
                      ? sectionTab === "BREAKING"
                        ? "bg-white/20 text-white"
                        : "bg-red-50 text-red-500"
                      : sectionTab === "BREAKING"
                        ? "bg-white/15 text-gray-200"
                        : "bg-gray-100 text-gray-400"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 rounded-full ${
                      isLiveActive
                        ? sectionTab === "BREAKING"
                          ? "animate-pulse bg-emerald-300"
                          : "animate-pulse bg-red-500"
                        : "bg-gray-400"
                    }`}
                  />
                  <span>{isLiveActive ? "LIVE" : "OFF"}</span>
                </span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={sectionTab === "NEWSROOM"}
                onClick={() => setSectionTab("NEWSROOM")}
                className={`flex w-full items-center justify-between rounded-xl px-3.5 py-3 text-left transition-colors ${
                  sectionTab === "NEWSROOM"
                    ? "bg-[#0058FF] text-white"
                    : "bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                <div>
                  <div className="flex items-center gap-2 text-sm font-black">
                    <span>📰</span>
                    <span>뉴스룸</span>
                  </div>
                  <p
                    className={`mt-0.5 text-[11px] font-medium ${
                      sectionTab === "NEWSROOM" ? "text-blue-100" : "text-gray-400"
                    }`}
                  >
                    심층 취재·주요 뉴스
                  </p>
                </div>
              </button>
            </div>
          </div>

          {/* 실시간 뉴스 투자 심리 카드 */}
          <div
            className="rounded-2xl border border-gray-200 bg-white p-4"
            aria-label="시장 뉴스 센티먼트 요약"
          >
            <h3 className="text-xs font-black text-gray-900">실시간 뉴스 투자 심리</h3>
            <div className="mt-2.5 flex h-6 overflow-hidden rounded-lg text-[11px] font-extrabold text-white">
              <div
                className="flex items-center justify-center bg-[#2EBD85]"
                style={{ width: `${sentimentBullPct}%` }}
              >
                강세 {sentimentBullPct}%
              </div>
              <div
                className="flex items-center justify-center bg-[#F6465D]"
                style={{ width: `${sentimentBearPct}%` }}
              >
                약세 {sentimentBearPct}%
              </div>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
              현물 ETF 자금 유입 및 거시 금리 동결 기조로 단기 매수 심리가 우위를 보이고 있습니다.
            </p>
            <Link
              href="/trading"
              className="mt-3 flex h-9 w-full items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-xs font-bold text-gray-700 hover:bg-gray-100"
            >
              선물 모의투자 터미널 →
            </Link>
          </div>
        </aside>

        {/* 중앙 메인 컨텐츠 영역 */}
        <div className="min-w-0 flex-1 space-y-5">
          <div ref={feedTopRef} className="scroll-mt-24" />
          {activeToastCount > 0 && (
            <div
              className="pointer-events-none fixed left-1/2 top-20 z-40 -translate-x-1/2"
              role="status"
              aria-live="polite"
            >
              <button
                type="button"
                onClick={handleLoadNewNews}
                className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-blue-400 bg-[#0058FF] px-4 py-2 text-xs font-bold text-white shadow-lg transition-all hover:bg-blue-700"
              >
                <span aria-hidden="true">⚡</span>
                <span>새 실시간 속보 {activeToastCount}건 보기</span>
                <span aria-hidden="true">↑</span>
              </button>
            </div>
          )}

          {sectionTab === "BREAKING" ? (
            /* ==================== [탭 1] 속보 (CoinNess /news 스타일) ==================== */
            <>
              {/* 상단 헤더: 속보 | 전체 속보 | 코인 속보 | 경제 속보 + 기사제보 */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-baseline gap-4">
                  <h2 className="text-2xl font-black tracking-tight text-gray-900 sm:text-3xl">
                    속보
                  </h2>
                  <div className="flex items-center gap-4" role="tablist" aria-label="속보 분야 탭">
                    {(
                      [
                        { key: "ALL", label: "전체 속보", count: allUnreadCount, badgeKey: "all" },
                        { key: "COIN", label: "코인 속보", count: coinUnreadCount, badgeKey: "coin" },
                        {
                          key: "ECONOMY",
                          label: "경제 속보",
                          count: economyUnreadCount,
                          badgeKey: "economy",
                        },
                      ] as const
                    ).map((tab, idx) => (
                      <div key={tab.key} className="flex items-center gap-4">
                        {idx > 0 && (
                          <span className="text-gray-300" aria-hidden="true">
                            |
                          </span>
                        )}
                        <button
                          type="button"
                          role="tab"
                          aria-selected={breakingSubTab === tab.key}
                          onClick={() => setBreakingSubTab(tab.key)}
                          className={`relative inline-flex items-center text-sm font-extrabold transition-colors ${
                            breakingSubTab === tab.key
                              ? "text-gray-900"
                              : "text-gray-400 hover:text-gray-700"
                          }`}
                        >
                          <span>{tab.label}</span>
                          {tab.count > 0 && (
                            <span
                              data-breaking-badge={tab.badgeKey}
                              aria-label={`${tab.label} 새 소식 ${tab.count}건`}
                              className="absolute -right-3.5 -top-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-extrabold leading-none text-white shadow-xs"
                            >
                              {tab.count}
                            </span>
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <Link
                  href="/community"
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 text-xs font-bold text-gray-600 hover:bg-gray-50"
                >
                  <span aria-hidden="true">✈</span>
                  <span>기사제보</span>
                </Link>
              </div>

              {/* 지금 꼭 봐야할 속보 + 인기 속보 2단 하이라이트 박스 */}
              <div className="grid grid-cols-1 gap-6 rounded-2xl border border-gray-200 bg-white p-6 lg:grid-cols-2">
                {/* 좌측: 지금 꼭 봐야할 속보 */}
                <div>
                  <h3 className="mb-3 text-sm font-black text-gray-900">지금 꼭 봐야할 속보</h3>
                  <div className="space-y-3">
                    {mustReadCards[0] && (
                      <div
                        onClick={() => {
                          if (mustReadCards[0].item) {
                            void inspectArticle(mustReadCards[0].id, mustReadCards[0].item);
                          } else if (visibleItems[0]) {
                            setSelectedDetail(visibleItems[0]);
                          }
                        }}
                        className="cursor-pointer rounded-xl bg-[#F7F8FA] p-4 transition-colors hover:bg-gray-100"
                      >
                        <p className="text-sm font-bold text-gray-900">
                          {mustReadCards[0].title}
                        </p>
                        <span className="mt-2 block text-xs font-medium text-gray-400">
                          {mustReadCards[0].timeAgo}
                        </span>
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {mustReadCards.slice(1).map(card => (
                        <div
                          key={card.id}
                          onClick={() => {
                            if (card.item) {
                              void inspectArticle(card.id, card.item);
                            } else if (visibleItems[0]) {
                              setSelectedDetail(visibleItems[0]);
                            }
                          }}
                          className="cursor-pointer rounded-xl bg-[#F7F8FA] p-3.5 transition-colors hover:bg-gray-100"
                        >
                          <p className="line-clamp-2 text-xs font-bold leading-relaxed text-gray-900">
                            {card.title}
                          </p>
                          <div className="mt-2 flex items-center gap-2 text-[11px] font-medium text-gray-400">
                            {card.badge && (
                              <span className="font-extrabold text-[#0058FF]">{card.badge}</span>
                            )}
                            <span>{card.timeAgo}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 우측: 인기 속보 */}
                <div className="flex flex-col justify-between">
                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-sm font-black text-gray-900">인기 속보</h3>
                      <div className="flex items-center gap-2 text-xs font-bold">
                        <button
                          type="button"
                          onClick={() => setPopularMode("QUOTE")}
                          className={
                            popularMode === "QUOTE"
                              ? "text-gray-900"
                              : "text-gray-400 hover:text-gray-700"
                          }
                        >
                          인용글 많은
                        </button>
                        <span className="text-gray-300" aria-hidden="true">
                          |
                        </span>
                        <button
                          type="button"
                          onClick={() => setPopularMode("REACTION")}
                          className={
                            popularMode === "REACTION"
                              ? "text-gray-900"
                              : "text-gray-400 hover:text-gray-700"
                          }
                        >
                          반응 많은
                        </button>
                      </div>
                    </div>

                    <ol className="space-y-3">
                      {popularBreakingList.map(item => (
                        <li
                          key={item.rank}
                          onClick={() => {
                            if (item.item) {
                              void inspectArticle(item.id, item.item);
                            }
                          }}
                          className="flex cursor-pointer items-center justify-between gap-3 text-xs"
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="w-4 shrink-0 font-black text-gray-400">
                              {item.rank}
                            </span>
                            <span className="truncate font-bold text-gray-800 hover:text-[#0058FF]">
                              {item.title}
                            </span>
                          </div>
                          <span className="shrink-0 text-[11px] font-medium text-gray-400">
                            · {item.timeAgo}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  <div className="mt-4 flex items-center justify-center gap-1.5" aria-hidden="true">
                    <span
                      className={`h-1.5 rounded-full ${
                        popularMode === "QUOTE" ? "w-4 bg-gray-400" : "w-1.5 bg-gray-200"
                      }`}
                    />
                    <span
                      className={`h-1.5 rounded-full ${
                        popularMode === "REACTION" ? "w-4 bg-gray-400" : "w-1.5 bg-gray-200"
                      }`}
                    />
                  </div>
                </div>
              </div>

              {/* 키워드로 보는 이슈 바 */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#F7F8FA] px-4 py-3 text-xs">
                <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                  <span className="font-extrabold text-gray-600">키워드로 보는 이슈</span>
                  <span className="text-gray-300" aria-hidden="true">
                    |
                  </span>
                  <span className="font-extrabold text-red-500">{activeIssue.tag}</span>
                  <strong className="truncate font-bold text-gray-900">
                    {activeIssue.headline}
                  </strong>
                  <span className="text-gray-400">{activeIssue.timeAgo}</span>
                </div>
                <div className="flex items-center gap-2 text-gray-500">
                  <span className="font-bold">
                    {(issueIndex % keywordIssueList.length) + 1} / {keywordIssueList.length}
                  </span>
                  <button
                    type="button"
                    aria-label="이전 이슈 키워드"
                    onClick={() =>
                      setIssueIndex(
                        prev => (prev - 1 + keywordIssueList.length) % keywordIssueList.length,
                      )
                    }
                    className="rounded px-1.5 py-0.5 hover:bg-gray-200"
                  >
                    ∧
                  </button>
                  <button
                    type="button"
                    aria-label="다음 이슈 키워드"
                    onClick={() => setIssueIndex(prev => (prev + 1) % keywordIssueList.length)}
                    className="rounded px-1.5 py-0.5 hover:bg-gray-200"
                  >
                    ∨
                  </button>
                </div>
              </div>

              {/* 퀵 필터 알약 칩 바 & 속보 정렬 (최신순 | 오래된순) */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div
                    className="flex items-center gap-1 rounded-full bg-[#F2F4F7] p-1"
                    role="group"
                    aria-label="속보 정렬 방식"
                  >
                    <button
                      type="button"
                      aria-pressed={breakingSort === "LATEST"}
                      onClick={() => {
                        setBreakingSort("LATEST");
                        resetPagination();
                      }}
                      className={`rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                        breakingSort === "LATEST"
                          ? "bg-gray-900 text-white"
                          : "text-gray-500 hover:text-gray-900"
                      }`}
                    >
                      최신순
                    </button>
                    <button
                      type="button"
                      aria-pressed={breakingSort === "OLDEST"}
                      onClick={() => {
                        setBreakingSort("OLDEST");
                        resetPagination();
                      }}
                      className={`rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                        breakingSort === "OLDEST"
                          ? "bg-gray-900 text-white"
                          : "text-gray-500 hover:text-gray-900"
                      }`}
                    >
                      오래된순
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setQuickChip(prev => (prev === "WATCH" ? "" : "WATCH"))}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-xs font-bold transition-colors ${
                      quickChip === "WATCH"
                        ? "border-gray-900 bg-gray-900 text-white"
                        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <span>★</span>
                    <span>관심 코인</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuickChip(prev => (prev === "MENTION" ? "" : "MENTION"))}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-xs font-bold transition-colors ${
                      quickChip === "MENTION"
                        ? "border-gray-900 bg-gray-900 text-white"
                        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <span>🎙</span>
                    <span>많이 언급된 코인</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuickChip(prev => (prev === "VOLUME" ? "" : "VOLUME"))}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-xs font-bold transition-colors ${
                      quickChip === "VOLUME"
                        ? "border-gray-900 bg-gray-900 text-white"
                        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <span>📊</span>
                    <span>거래 많은 코인</span>
                  </button>
                </div>
                <span className="text-xs font-medium text-gray-400">
                  최근 6시간 실시간 속보 · 4시간 경과 자동 정리 · KST 기준
                </span>
              </div>
            </>
          ) : (
            /* ==================== [탭 2] 뉴스룸 (CoinNess /article 스타일) ==================== */
            <>
              <div>
                <h2 className="text-2xl font-black tracking-tight text-gray-900 sm:text-3xl">
                  뉴스룸
                </h2>
              </div>

              {/* 중앙 세그먼트 탭 바: 전체 | 암호화폐 | 해외증시 | 환율/금리 */}
              <div
                className="mx-auto grid max-w-xl grid-cols-4 gap-1 rounded-2xl bg-[#F2F4F7] p-1.5"
                role="tablist"
                aria-label="뉴스룸 분야 탭"
              >
                {(
                  [
                    { key: "ALL", label: "전체" },
                    { key: "CRYPTO", label: "암호화폐" },
                    { key: "STOCKS", label: "해외증시" },
                    { key: "FX_RATES", label: "환율/금리" },
                  ] as const
                ).map(tab => (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={newsroomTab === tab.key}
                    onClick={() => setNewsroomTab(tab.key)}
                    className={`rounded-xl py-2 text-xs font-bold transition-colors sm:text-sm ${
                      newsroomTab === tab.key
                        ? "bg-white text-gray-900"
                        : "text-gray-500 hover:text-gray-800"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* 최신 뉴스 | 많이 본 뉴스 | 오래된 순 알약 정렬 버튼 */}
              <div className="flex items-center gap-2" role="group" aria-label="뉴스룸 정렬 방식">
                <button
                  type="button"
                  aria-pressed={newsroomSort === "LATEST"}
                  onClick={() => {
                    setNewsroomSort("LATEST");
                    resetPagination();
                  }}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors ${
                    newsroomSort === "LATEST"
                      ? "bg-gray-800 text-white"
                      : "text-gray-500 hover:text-gray-900"
                  }`}
                >
                  최신 뉴스
                </button>
                <button
                  type="button"
                  aria-pressed={newsroomSort === "POPULAR"}
                  onClick={() => {
                    setNewsroomSort("POPULAR");
                    resetPagination();
                  }}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors ${
                    newsroomSort === "POPULAR"
                      ? "bg-gray-800 text-white"
                      : "text-gray-500 hover:text-gray-900"
                  }`}
                >
                  많이 본 뉴스
                </button>
                <button
                  type="button"
                  aria-pressed={newsroomSort === "OLDEST"}
                  onClick={() => {
                    setNewsroomSort("OLDEST");
                    resetPagination();
                  }}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors ${
                    newsroomSort === "OLDEST"
                      ? "bg-gray-800 text-white"
                      : "text-gray-500 hover:text-gray-900"
                  }`}
                >
                  오래된 순
                </button>
              </div>
            </>
          )}

          {/* 공통 셀렉트박스 3열 상세 필터 & 키워드 검색 바 */}
          <div className="ym-news-filter-panel space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold text-gray-500">
                  뉴스 카테고리
                </span>
                <select
                  aria-label="뉴스 카테고리 필터"
                  value={category}
                  onChange={event => {
                    setCategory(event.target.value as "" | NewsCategory);
                    resetPagination();
                  }}
                  className="h-10 w-full rounded-xl border border-gray-300 bg-white px-3.5 text-xs font-bold text-gray-900 focus:border-[#0058FF] focus:outline-none"
                >
                  {NEWS_CATEGORIES.map(tab => (
                    <option key={tab.key || "ALL"} value={tab.key}>
                      {tab.key === "" ? "전체 카테고리" : tab.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-bold text-gray-500">
                  연관 선물 종목
                </span>
                <select
                  aria-label="뉴스 종목 태그 필터"
                  value={symbolTag}
                  onChange={event => {
                    setSymbolTag(event.target.value);
                    resetPagination();
                  }}
                  className="h-10 w-full rounded-xl border border-gray-300 bg-white px-3.5 text-xs font-bold text-gray-900 focus:border-[#0058FF] focus:outline-none"
                >
                  {SYMBOL_FILTER_TAGS.map(tag => (
                    <option key={tag || "ALL_SYMBOL"} value={tag}>
                      {tag ? `#${tag} (${tag}USDT)` : "전체 종목"}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-bold text-gray-500">
                  브리핑 보기 방식
                </span>
                <select
                  aria-label="뉴스 브리핑 보기 방식"
                  value={viewMode}
                  onChange={event => setViewMode(event.target.value as "ALL" | "HEADLINE")}
                  className="h-10 w-full rounded-xl border border-gray-300 bg-white px-3.5 text-xs font-bold text-gray-900 focus:border-[#0058FF] focus:outline-none"
                >
                  <option value="ALL">전체 뉴스·속보</option>
                  <option value="HEADLINE">중요 헤드라인</option>
                </select>
              </label>
            </div>

            <form
              className="member-search ym-news-search-form flex items-center gap-2 pt-0.5"
              onSubmit={event => {
                event.preventDefault();
                setSubmittedKeyword(keyword.trim());
                resetPagination();
              }}
            >
              <input
                type="search"
                className="h-10 flex-1 rounded-xl border border-gray-300 bg-white px-3.5 text-xs font-medium text-gray-900 placeholder-gray-400 focus:border-[#0058FF] focus:outline-none"
                aria-label="뉴스 키워드 검색"
                placeholder="키워드 검색 (예: ETF, 연준, 금리, BTC)"
                maxLength={40}
                value={keyword}
                onChange={event => setKeyword(event.target.value)}
              />
              <button
                type="submit"
                className="ym-inline-check-btn inline-flex h-10 shrink-0 items-center justify-center rounded-xl bg-[#0058FF] px-4 text-xs font-bold text-white whitespace-nowrap transition-colors hover:bg-blue-700"
              >
                뉴스 검색
              </button>
            </form>
          </div>

          {query.isPending && (
            <p role="status" className="member-message">
              실시간 뉴스 피드를 불러오는 중입니다…
            </p>
          )}
          {query.isError && (
            <p role="alert" className="member-message">
              뉴스 피드를 조회하지 못했습니다. {contentMessage(query.error)}{" "}
              <button
                type="button"
                className="account-refresh"
                onClick={() => void query.refetch()}
              >
                다시 조회
              </button>
            </p>
          )}
          {detailError && (
            <p role="alert" className="member-message">
              {detailError}
            </p>
          )}

          {!query.isPending && !query.isError && visibleItems.length === 0 && (
            <p className="member-message">선택한 조건에 해당하는 뉴스가 없습니다.</p>
          )}

          {/* 메인 리스트: 속보 타임라인 vs 뉴스룸 아티클 리스트 */}
          {visibleItems.length > 0 &&
            (sectionTab === "BREAKING" ? (
              <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
                <div className="border-b border-gray-200 bg-[#F7F8FA] px-5 py-3 text-xs font-bold text-gray-700">
                  📅 오늘, 2026년 11월 10일 화요일
                </div>

                <ul className="divide-y divide-gray-100" aria-label=" 실시간 속보 목록">
                  {visibleItems.map(item => {
                    const userReaction = reactions[item.id];
                    const liveReaction = liveReactions[item.id];
                    const baseBull =
                      item.bullCount && item.bullCount > 0
                        ? item.bullCount
                        : 34 + (item.id % 19);
                    const baseBear =
                      item.bearCount && item.bearCount > 0
                        ? item.bearCount
                        : 9 + (item.id % 7);
                    const bullCount = liveReaction
                      ? liveReaction.bullCount
                      : baseBull + (userReaction === "bull" ? 1 : 0);
                    const bearCount = liveReaction
                      ? liveReaction.bearCount
                      : baseBear + (userReaction === "bear" ? 1 : 0);
                    const extraBody = cleanBreakingBody(
                      item.content,
                      item.summary,
                      item.aiSummary,
                    );

                    return (
                      <li key={item.id} className="p-5 transition-colors hover:bg-gray-50/50">
                        <article className="flex items-start gap-4">
                          <time
                            dateTime={item.publishedAt}
                            className="mt-0.5 shrink-0 rounded-md bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-600"
                          >
                            {kstTimeOnly(item.publishedAt)}
                          </time>

                          <div className="min-w-0 flex-1">
                            <h3
                              onClick={() => void inspectArticle(item.id, item)}
                              className="cursor-pointer text-[15px] font-bold text-gray-900 hover:text-[#0058FF]"
                            >
                              {item.title}
                            </h3>
                            <p className="mt-1.5 text-sm leading-relaxed text-gray-600">
                              {item.summary}
                            </p>
                            {extraBody && (
                              <p className="mt-1 text-xs leading-relaxed text-gray-500">
                                {extraBody}
                              </p>
                            )}

                            {item.aiSummary && (
                              <div className="mt-2.5 rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs font-bold text-[#5B44F2]">
                                ✦ AI 분석: {item.aiSummary}
                              </div>
                            )}

                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => void inspectArticle(item.id, item)}
                                className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2.5 py-1 text-[11px] font-extrabold text-[#5B44F2] hover:bg-indigo-100"
                              >
                                <span>✦</span>
                                <span>AI 분석</span>
                              </button>

                              <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-600">
                                {newsCategoryLabel(item.category)}
                              </span>

                              {item.symbolTag && (
                                <>
                                  <span className="rounded-full border border-gray-200 bg-white px-2.5 py-0.5 text-[11px] font-extrabold text-gray-800">
                                    #{item.symbolTag}
                                  </span>
                                  <Link
                                    href="/trading"
                                    className="rounded-md bg-blue-50 px-2.5 py-0.5 text-[11px] font-bold text-[#0058FF] hover:underline"
                                  >
                                    {item.symbolTag} 선물 거래 바로가기 ({item.symbolTag} 선물 모의투자 이동)
                                  </Link>
                                </>
                              )}

                              {item.sourceUrl && (
                                <a
                                  href={item.sourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="rounded-md border border-gray-200 bg-white px-2.5 py-0.5 text-[11px] font-bold text-gray-600 hover:border-[#0058FF] hover:text-[#0058FF]"
                                >
                                  원문 기사 보기 ↗
                                </a>
                              )}
                            </div>

                            <div className="mt-3 flex items-center justify-between">
                              <div
                                className="flex items-center gap-3 text-xs font-bold text-gray-400"
                                role="group"
                                aria-label="뉴스 강세 약세 반응"
                              >
                                <button
                                  type="button"
                                  aria-pressed={userReaction === "bull"}
                                  onClick={() => toggleReaction(item.id, "bull")}
                                  className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 transition-colors ${
                                    userReaction === "bull"
                                      ? "bg-emerald-50 text-[#2EBD85]"
                                      : "hover:bg-gray-100 hover:text-gray-700"
                                  }`}
                                >
                                  <span>📈</span>
                                  <span>{bullCount}</span>
                                </button>
                                <button
                                  type="button"
                                  aria-pressed={userReaction === "bear"}
                                  onClick={() => toggleReaction(item.id, "bear")}
                                  className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 transition-colors ${
                                    userReaction === "bear"
                                      ? "bg-red-50 text-[#F6465D]"
                                      : "hover:bg-gray-100 hover:text-gray-700"
                                  }`}
                                >
                                  <span>📉</span>
                                  <span>{bearCount}</span>
                                </button>
                              </div>

                              <button
                                type="button"
                                onClick={() => void inspectArticle(item.id, item)}
                                className="text-xs font-bold text-gray-400 hover:text-gray-700"
                              >
                                뉴스 상세 모달 보기 →
                              </button>
                            </div>
                          </div>
                        </article>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
                <ul className="divide-y divide-gray-100" aria-label="뉴스룸 기사 목록">
                  {visibleItems.map(item => {
                    const hasValidThumbnail = Boolean(
                      item.thumbnailUrl &&
                        item.thumbnailUrl.trim() !== "" &&
                        !failedThumbIds[item.id],
                    );
                    const categoryHashtag = `#${newsCategoryLabel(item.category).replace(
                      /\s+/g,
                      "",
                    )}`;
                    const subHashtag = newsroomSubHashtag(item);
                    const hashtags = Array.from(
                      new Set([
                        item.symbolTag ? `#${item.symbolTag}` : "#MACRO",
                        categoryHashtag,
                        subHashtag,
                      ]),
                    );

                    return (
                      <li key={item.id} className="p-5 transition-colors hover:bg-gray-50/60">
                        <article className="flex items-start justify-between gap-5">
                          <div className="min-w-0 flex-1 w-full">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                              <time
                                dateTime={item.publishedAt}
                                className="rounded bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-600"
                              >
                                {kstTimeOnly(item.publishedAt)}
                              </time>
                              <span>2026년 11월 10일 화요일</span>
                              <span>·</span>
                              <span className="font-bold text-gray-500">
                                {newsCategoryLabel(item.category)}
                              </span>
                            </div>

                            <h3
                              onClick={() => void inspectArticle(item.id, item)}
                              className="mt-1.5 cursor-pointer text-base font-bold text-gray-900 hover:text-[#0058FF]"
                            >
                              {item.title}
                            </h3>
                            <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-gray-600">
                              {cleanNewsroomExcerpt(
                                item.summary,
                                item.content,
                                item.aiSummary,
                              )}
                            </p>
                            {item.aiSummary && (
                              <p className="mt-1.5 text-xs font-bold text-[#5B44F2]">
                                ✦ AI 분석: {item.aiSummary}
                              </p>
                            )}

                            <div
                              data-newsroom-hashtags="true"
                              className="mt-2.5 flex flex-wrap items-center gap-1.5"
                            >
                              {hashtags.map(tag => (
                                <span
                                  key={tag}
                                  className="rounded-md bg-blue-50/80 px-2 py-0.5 text-[11px] font-extrabold text-[#0058FF]"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>

                            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                              <span className="font-medium text-gray-400">
                                출처 {item.sourceName}
                              </span>
                              {item.sourceUrl && (
                                <a
                                  href={item.sourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-bold text-gray-600 hover:text-[#0058FF] hover:underline"
                                >
                                  원문 기사 보기 ↗
                                </a>
                              )}
                              {item.symbolTag && (
                                <Link
                                  href="/trading"
                                  className="font-bold text-[#0058FF] hover:underline"
                                >
                                  {item.symbolTag} 선물 모의투자 이동 →
                                </Link>
                              )}
                              <button
                                type="button"
                                onClick={() => void inspectArticle(item.id, item)}
                                className="font-bold text-gray-500 hover:text-gray-900"
                              >
                                뉴스 상세 모달 보기
                              </button>
                            </div>
                          </div>

                          {hasValidThumbnail ? (
                            <div
                              data-s3-slot="news-thumbnail"
                              onClick={() => void inspectArticle(item.id, item)}
                              className="relative flex h-20 w-28 shrink-0 cursor-pointer overflow-hidden rounded-xl border border-gray-200 bg-gray-100 sm:h-24 sm:w-36"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={item.thumbnailUrl ?? ""}
                                alt={item.title}
                                onError={() =>
                                  setFailedThumbIds(prev => ({ ...prev, [item.id]: true }))
                                }
                                className="h-full w-full object-cover"
                              />
                            </div>
                          ) : null}
                        </article>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}

          <div
            ref={loadMoreSentinelRef}
            data-infinite-scroll="news-sentinel"
            className="member-actions pt-2"
          >
            {hasNext && (
              <button
                type="button"
                className="signup-button"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? "불러오는 중…" : "다음 뉴스 더보기 (이전 뉴스 더보기)"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 선택한 뉴스 상세 딤 팝업 모달 */}
      <DimModal
        open={selectedDetail !== null}
        onClose={() => setSelectedDetail(null)}
        title={selectedDetail?.title ?? "뉴스 상세"}
        subtitle={
          selectedDetail
            ? `[${newsCategoryLabel(selectedDetail.category)}] · 출처 ${selectedDetail.sourceName} · ${kst(selectedDetail.publishedAt)} KST`
            : undefined
        }
        footer={
          <div className="ym-modal-actions">
            {selectedDetail?.sourceUrl && (
              <a
                href={selectedDetail.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="signup-button ym-btn-inline"
              >
                원문 기사 보기 ↗
              </a>
            )}
            {selectedDetail?.symbolTag && (
              <Link
                href="/trading"
                className="login-button ym-btn-inline"
                onClick={() => setSelectedDetail(null)}
              >
                {selectedDetail.symbolTag} 선물 모의투자 바로가기
              </Link>
            )}
            <button
              type="button"
              className="signup-button ym-btn-inline"
              onClick={() => setSelectedDetail(null)}
            >
              상세 닫기
            </button>
          </div>
        }
      >
        {selectedDetail && (
          <div className="ym-modal-prose">
            {selectedDetail.aiSummary && (
              <p>
                <strong>✦ AI 분석:</strong> {selectedDetail.aiSummary}
              </p>
            )}
            <p>
              <strong>요약:</strong> {selectedDetail.summary}
            </p>
            <p>{selectedDetail.content}</p>
          </div>
        )}
      </DimModal>
    </MemberShell>
  );
}
