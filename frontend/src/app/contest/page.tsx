import type { Metadata } from "next";
import { ContestHub } from "@/features/contest/components/contest-hub";

export const metadata: Metadata = {
  title: "시즌별 선물 모의투자 대회 | 요기망치",
  description: "시즌별 독립 시드머니로 수익률을 겨루는 요기망치 선물 모의투자 대회 허브 및 리더보드",
};

export default function ContestPage() {
  return <ContestHub />;
}
