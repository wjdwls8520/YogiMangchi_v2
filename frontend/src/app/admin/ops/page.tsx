import type { Metadata } from "next";
import { AdminOpsView } from "../../../features/admin/components/admin-ops";

export const metadata: Metadata = {
  title: "시스템 운영 진단 · 관리자",
  description: "Content·Trading 서버 헬스체크, Risk Hold 해제, Outbox 재시도 및 1:1 고객문의 통합 관제 화면입니다.",
};

export default function AdminOpsPage() {
  return <AdminOpsView />;
}
