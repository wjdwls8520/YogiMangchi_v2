import { CommunityBoard } from "../../../../features/member/components/community-board";

export default async function CommunityPostDetailPage({
  params,
}: {
  params: Promise<{ category: string; id: string }>;
}) {
  const { category, id } = await params;
  const tab = category === "best" ? "best" : category === "latest" ? "latest" : "all";
  const postId = Number(id);
  return (
    <CommunityBoard
      initialV1Tab={tab}
      highlightPostId={Number.isFinite(postId) ? postId : undefined}
    />
  );
}
