"use client";

import type { parseSummary } from "../api/account";
import { formatDecimal, pnlTrend } from "../api/account";

export function WalletOverview({ wallet, layout = "compact" }: { wallet: ReturnType<typeof parseSummary>["wallet"]; layout?: "compact" | "grid" }) {
  return <section className="wallet-overview" data-layout={layout} aria-label="Wallet 요약"><h3>Wallet · USDT</h3><dl>
    {([
      ["Wallet Balance","지갑 잔고",wallet.balance],["Equity","총 평가 자산",wallet.equity],["Available Balance","사용 가능 잔고",wallet.availableBalance],
      ["Used Margin","사용 증거금",wallet.usedMargin],["Reserved Margin","주문 예약 증거금",wallet.reservedMargin],
      ["Unrealized PnL","미실현 손익",wallet.unrealizedPnl],["Realized PnL","실현 손익",wallet.realizedPnl],
    ] as const).map(([label,meaning,value])=><div key={label}><dt>{label}{layout === "grid" && <span className="wallet-label-meaning"> ({meaning})</span>}</dt><dd data-trend={label.includes("PnL") ? pnlTrend(value) : undefined}>{formatDecimal(value)}</dd></div>)}
    {layout === "grid" && <div><dt>평가 상태</dt><dd>{wallet.valuationStatus === "FRESH" ? "정상" : "시세 평가 불가"}</dd></div>}
  </dl><p>서버 조회 기준{layout === "compact" && ` · ${wallet.valuationStatus === "FRESH" ? "평가 정상" : "시세 평가 불가"}`}</p></section>;
}
