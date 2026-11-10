import type { Metadata } from "next";
import { AdminUsers } from "@/features/admin/components/admin-users";

export const metadata: Metadata = {
  title: "관리자 · 회원 관리 | 요기망치",
  description: "요기망치 관리자 회원 목록 조회 및 계정 상태·강제 탈퇴 관리",
};

export default function AdminUsersPage() {
  return <AdminUsers />;
}
