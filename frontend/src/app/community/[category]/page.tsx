import type { CommunityCategory } from "../../../features/member/api/community-news";
import { CommunityBoard } from "../../../features/member/components/community-board";

const CATEGORY_SLUG_MAP: Record<string, CommunityCategory> = {
  notice: "NOTICE",
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
  const { category } = await params;
  const normalized = category.trim().toLowerCase();
  const tab =
    normalized === "best"
      ? "best"
      : normalized === "notice"
        ? "notice"
        : normalized === "latest"
          ? "latest"
          : "all";
  const initialCategory = CATEGORY_SLUG_MAP[normalized] ?? "";
  return (
    <CommunityBoard
      initialV1Tab={tab}
      initialCategory={initialCategory}
    />
  );
}
