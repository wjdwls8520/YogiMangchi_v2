import type { Metadata } from "next";
import { AdminReportsView } from "../../../features/admin/components/admin-reports";

export const metadata: Metadata = {
  title: "신고 관리 | 요기망치 ADMIN",
  description: "요기망치 커뮤니티 게시글 및 댓글 신고 통합 검수 및 제재 관리 콘솔",
};

export default function AdminReportsPage() {
  return <AdminReportsView />;
}
