import type { Metadata } from "next";
import { CommunityBoard } from "../../../../features/member/components/community-board";

export const metadata: Metadata = {
  title: "커뮤니티 게시글",
};

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
