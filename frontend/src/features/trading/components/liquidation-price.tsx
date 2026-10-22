import { formatMarketPrice } from "../market/price-format";

const labels: Record<string, string> = {
  PRICE_UNAVAILABLE: "시세 대기", NO_THRESHOLD: "유효 임계값 없음", UNSUPPORTED_MODEL: "산정 불가",
  ALREADY_AT_RISK: "청산 위험", MARGIN_MIGRATION_REQUIRED: "담보 전환 필요",
};
export function LiquidationPrice({ value, status, asOf, fresh }: { value: string | null; status: string; asOf: string | null; fresh: boolean }) {
  const estimated = status === "ESTIMATED_DOWNWARD" || status === "ESTIMATED_UPWARD";
  const label = estimated && !fresh ? "시세 대기" : labels[status];
  return <span title={asOf ? `서버 산정 기준 ${new Date(asOf).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})} · 실제 체결가는 Mark에 따라 달라질 수 있습니다.` : "서버 산정값을 기다리고 있습니다."}>
    {estimated && fresh && value ? formatMarketPrice(value) : label ?? "—"}
  </span>;
}
