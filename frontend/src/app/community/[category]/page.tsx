import { loadInitialContestSidebarSnapshot } from "../../../features/contest/api/contest-client";
import { CommunityBoard } from "../../../features/member/components/community-board";

export const dynamic = "force-dynamic";

export default async function CommunityCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const [{ category }, contestSidebar] = await Promise.all([
    params,
    loadInitialContestSidebarSnapshot(),
  ]);
  const tab = category === "best" ? "best" : category === "latest" ? "latest" : "all";
  return (
    <CommunityBoard
      initialV1Tab={tab}
      initialContestSeasons={contestSidebar.seasons}
      initialContestLeaderboard={contestSidebar.leaderboard}
      initialContestProfiles={contestSidebar.profiles}
    />
  );
}
