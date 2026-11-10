import { loadInitialContestSidebarSnapshot } from "../../../../features/contest/api/contest-client";
import { CommunityBoard } from "../../../../features/member/components/community-board";

export const dynamic = "force-dynamic";

export default async function CommunityPostDetailPage({
  params,
}: {
  params: Promise<{ category: string; id: string }>;
}) {
  const [{ category, id }, contestSidebar] = await Promise.all([
    params,
    loadInitialContestSidebarSnapshot(),
  ]);
  const tab = category === "best" ? "best" : category === "latest" ? "latest" : "all";
  const postId = Number(id);
  return (
    <CommunityBoard
      initialV1Tab={tab}
      highlightPostId={Number.isFinite(postId) ? postId : undefined}
      initialContestSeasons={contestSidebar.seasons}
      initialContestLeaderboard={contestSidebar.leaderboard}
      initialContestProfiles={contestSidebar.profiles}
    />
  );
}
