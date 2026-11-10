import type { Metadata, Viewport } from "next";
import { TradingWorkspace } from "@/features/trading/components/trading-workspace";

export const metadata: Metadata = {
  title: "선물 모의투자",
  description: "실시간 시세 기반 요기망치 선물 모의투자",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function TradingPage() {
  return <TradingWorkspace />;
}
