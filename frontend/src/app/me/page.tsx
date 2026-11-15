import {
  MemberMyProfilePage,
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

export default async function MePage({
  searchParams,
}: {
  searchParams?: Promise<{
    tab?: string;
    detailTab?: string;
    contestSubTab?: string;
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

  return (
    <MemberMyProfilePage
      initialMainTab={mainTab}
      initialDetailTab={detailTab}
      initialContestSubTab={contestSubTab}
    />
  );
}
