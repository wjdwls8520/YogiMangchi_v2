import { NewsFeed } from "../../features/member/components/news-feed";

export default async function NewsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string; sub?: string; sort?: string }>;
}) {
  const resolved = searchParams ? await searchParams : undefined;
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
    sortParam === "oldest" ? "OLDEST" : sortParam === "latest" ? "LATEST" : undefined;
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
      initialSection={initialSection}
      initialBreakingSubTab={initialBreakingSubTab}
      initialBreakingSort={initialBreakingSort}
      initialNewsroomTab={initialNewsroomTab}
      initialNewsroomSort={initialNewsroomSort}
    />
  );
}
