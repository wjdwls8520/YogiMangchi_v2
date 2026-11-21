import type { Metadata } from "next";
import { SupportCenter } from "../../features/member/components/support-center";

export const metadata: Metadata = {
  title: "고객센터 · 1:1 문의",
  description: "요기망치 1:1 고객문의 접수 및 운영팀 답변 내역을 확인합니다.",
};

export default function SupportPage() {
  return <SupportCenter />;
}
