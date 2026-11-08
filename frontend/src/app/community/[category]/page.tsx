import { CommunityBoard } from "../../../features/member/components/community-board";

export default async function CommunityCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;
  const tab = category === "best" ? "best" : category === "latest" ? "latest" : "all";
  return <CommunityBoard initialV1Tab={tab} />;
}
