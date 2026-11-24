import { NewsFeed } from "../../features/member/components/news-feed";
import { parseNewsHighlights, type NewsHighlights } from "../../features/member/api/community-news";
import {
  fetchRedisMarketOverview,
  type MarketOverviewData,
} from "../../features/member/api/market-overview";
import { resolveContentOrigin, resolveTradingOrigin } from "../../lib/api-origins";

async function loadInitialNewsSidebarData(): Promise<{
  initialHighlights?: NewsHighlights;
  initialMarketOverview?: MarketOverviewData;
}> {
  const contentBase = resolveContentOrigin();
  const tradingBase = resolveTradingOrigin();

  const [highlightsRes, overviewRes] = await Promise.allSettled([
    fetch(`${contentBase}/api/v1/news/highlights`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
      headers: { Accept: "application/json" },
    }).then(async res => (res.ok ? parseNewsHighlights(await res.json()) : undefined)),
    fetchRedisMarketOverview(tradingBase, AbortSignal.timeout(1500)),
  ]);

  return {
    initialHighlights: highlightsRes.status === "fulfilled" ? highlightsRes.value : undefined,
    initialMarketOverview: overviewRes.status === "fulfilled" ? overviewRes.value : undefined,
  };
}

export default async function NewsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string; sub?: string; sort?: string }>;
}) {
  const [resolved, { initialHighlights, initialMarketOverview }] = await Promise.all([
    searchParams ? searchParams : Promise.resolve(undefined),
    loadInitialNewsSidebarData(),
  ]);
  const tabParam = resolved?.tab?.toLowerCase();
  const subParam = resolved?.sub?.toLowerCase();
  const sortParam = resolved?.sort?.toLowerCase();

  const initialSection =
    tabParam === "newsroom" ? "NEWSROOM" : tabParam === "breaking" ? "BREAKING" : undefined;
  const initialBreakingSubTab =
    subParam === "economy" ? "ECONOMY" : subParam === "coin" ? "COIN" : undefined;
  const initialNewsroomTab =
    subParam === "crypto"
      ? "CRYPTO"
      : subParam === "stocks"
        ? "STOCKS"
        : subParam === "fx" || subParam === "fx_rates"
          ? "FX_RATES"
          : subParam === "all"
            ? "ALL"
            : undefined;
  const initialBreakingSort =
    sortParam === "popular"
      ? "POPULAR"
      : sortParam === "oldest"
        ? "OLDEST"
        : sortParam === "latest"
          ? "LATEST"
          : undefined;
  const initialNewsroomSort =
    sortParam === "popular"
      ? "POPULAR"
      : sortParam === "oldest"
        ? "OLDEST"
        : sortParam === "latest"
          ? "LATEST"
          : undefined;

  return (
    <NewsFeed
      initialHighlights={initialHighlights}
      initialMarketOverview={initialMarketOverview}
      initialSection={initialSection}
      initialBreakingSubTab={initialBreakingSubTab}
      initialBreakingSort={initialBreakingSort}
      initialNewsroomTab={initialNewsroomTab}
      initialNewsroomSort={initialNewsroomSort}
    />
  );
}
