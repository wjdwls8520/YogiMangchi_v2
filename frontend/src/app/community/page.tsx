import { loadInitialContestSidebarSnapshot } from "../../features/contest/api/contest-client";
import { CommunityBoard } from "../../features/member/components/community-board";

export const dynamic = "force-dynamic";

export default async function CommunityPage() {
  const contestSidebar = await loadInitialContestSidebarSnapshot();
  return (
    <CommunityBoard
      initialContestSeasons={contestSidebar.seasons}
      initialContestLeaderboard={contestSidebar.leaderboard}
      initialContestProfiles={contestSidebar.profiles}
    />
  );
}
