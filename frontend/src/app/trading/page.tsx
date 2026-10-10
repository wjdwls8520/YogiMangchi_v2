import type { Metadata } from "next";
import { TradingWorkspace } from "@/features/trading/components/trading-workspace";

export const metadata: Metadata = {
  title: "선물 모의투자",
  description: "요기망치 선물 모의투자 Trading 화면 미리보기",
};

export default function TradingPage() {
  return <TradingWorkspace />;
}
