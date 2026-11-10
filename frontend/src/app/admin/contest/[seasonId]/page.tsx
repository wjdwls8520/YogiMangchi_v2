import type { Metadata } from "next";
import { AdminContestDetail } from "@/features/admin/components/admin-contest-detail";

export const metadata: Metadata = {
  title: "관리자 · 대회 시즌 상세 운영 및 정산 | 요기망치",
  description: "요기망치 관리자 대회 시즌 상세 운영, 500개 청크 강제정산 및 참가 신청자 승인/반려",
};

export default async function AdminContestDetailPage({
  params,
}: {
  params: Promise<{ seasonId: string }>;
}) {
  const { seasonId } = await params;
  return <AdminContestDetail seasonId={seasonId} />;
}
