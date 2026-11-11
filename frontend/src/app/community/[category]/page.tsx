import { loadInitialContestSidebarSnapshot } from "../../../features/contest/api/contest-client";
import type { CommunityCategory } from "../../../features/member/api/community-news";
import { CommunityBoard } from "../../../features/member/components/community-board";

export const dynamic = "force-dynamic";

const CATEGORY_SLUG_MAP: Record<string, CommunityCategory> = {
  market: "MARKET",
  analysis: "ANALYSIS",
  position: "POSITION",
  free: "FREE",
};

export default async function CommunityCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const [{ category }, contestSidebar] = await Promise.all([
    params,
    loadInitialContestSidebarSnapshot(),
  ]);
  const normalized = category.trim().toLowerCase();
  const tab = normalized === "best" ? "best" : normalized === "latest" ? "latest" : "all";
  const initialCategory = CATEGORY_SLUG_MAP[normalized] ?? "";
  return (
    <CommunityBoard
      initialV1Tab={tab}
      initialCategory={initialCategory}
      initialContestSeasons={contestSidebar.seasons}
      initialContestLeaderboard={contestSidebar.leaderboard}
      initialContestProfiles={contestSidebar.profiles}
    />
  );
}
