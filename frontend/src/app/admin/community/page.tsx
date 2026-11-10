import type { Metadata } from "next";
import { AdminCommunity } from "@/features/admin/components/admin-community";

export const metadata: Metadata = {
  title: "관리자 · 커뮤니티 관리 | 요기망치",
  description: "요기망치 관리자 커뮤니티 게시글 및 댓글 모니터링·삭제 관리",
};

export default function AdminCommunityPage() {
  return <AdminCommunity />;
}
