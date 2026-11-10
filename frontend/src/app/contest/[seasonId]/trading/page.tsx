import type { Metadata, Viewport } from "next";
import { ContestTradingTerminal } from "@/features/contest/components/contest-trading-terminal";

export const metadata: Metadata = {
  title: "대회 전용 선물 모의투자 | 요기망치",
  description: "시즌별 독립 대회 지갑으로 운영하는 요기망치 대회 전용 선물 모의투자",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function ContestTradingPage({
  params,
}: {
  params: Promise<{ seasonId: string }>;
}) {
  const { seasonId } = await params;
  return <ContestTradingTerminal seasonId={seasonId} />;
}
