import {
  MemberMyProfilePage,
  type MyPageCommunityTab,
  type MyPageMainTab,
} from "../../features/member/components/member-profile-portfolio";

const VALID_MAIN_TABS = new Set<MyPageMainTab>([
  "mock-assets",
  "contest-assets",
  "portfolio",
  "community",
]);
const VALID_DETAIL_TABS = new Set([
  "holdings",
  "pnl",
  "orders",
  "trades",
  "open",
] as const);
const VALID_COMMUNITY_TABS = new Set<MyPageCommunityTab>([
  "posts",
  "replies",
  "likedPosts",
  "likedReplies",
  "reports",
]);

export default async function MePage({
  searchParams,
}: {
  searchParams?: Promise<{
    tab?: string;
    detailTab?: string;
    contestSubTab?: string;
    seasonId?: string;
    communityTab?: string;
  }>;
}) {
  const resolved = searchParams ? await searchParams : undefined;
  const mainTab =
    resolved?.tab && VALID_MAIN_TABS.has(resolved.tab as MyPageMainTab)
      ? (resolved.tab as MyPageMainTab)
      : undefined;
  const detailTab =
    resolved?.detailTab &&
    VALID_DETAIL_TABS.has(
      resolved.detailTab as "holdings" | "pnl" | "orders" | "trades" | "open",
    )
      ? (resolved.detailTab as "holdings" | "pnl" | "orders" | "trades" | "open")
      : undefined;
  const contestSubTab =
    resolved?.contestSubTab === "finished"
      ? "finished"
      : resolved?.contestSubTab === "live"
        ? "live"
        : undefined;
  const parsedSeasonId = resolved?.seasonId ? Number(resolved.seasonId) : NaN;
  const seasonId =
    Number.isSafeInteger(parsedSeasonId) && parsedSeasonId > 0
      ? parsedSeasonId
      : undefined;
  const communityTab =
    resolved?.communityTab && VALID_COMMUNITY_TABS.has(resolved.communityTab as MyPageCommunityTab)
      ? (resolved.communityTab as MyPageCommunityTab)
      : undefined;

  return (
    <MemberMyProfilePage
      initialMainTab={mainTab}
      initialDetailTab={detailTab}
      initialContestSubTab={contestSubTab}
      initialSeasonId={seasonId}
      initialCommunityTab={communityTab}
    />
  );
}
