import type { Metadata } from "next";
import { AdminContestList } from "@/features/admin/components/admin-contest-list";

export const metadata: Metadata = {
  title: "관리자 · 대회 시즌 관리 | 요기망치",
  description: "요기망치 관리자 대회 시즌 목록 및 시즌 생성·상태 제어",
};

export default function AdminContestPage() {
  return <AdminContestList />;
}
