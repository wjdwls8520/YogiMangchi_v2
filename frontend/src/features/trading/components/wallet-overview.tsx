"use client";

import type { parseSummary } from "../api/account";
import { formatDecimal, pnlTrend } from "../api/account";

export function WalletOverview({ wallet }: { wallet: ReturnType<typeof parseSummary>["wallet"] }) {
  return <section className="wallet-overview" aria-label="Wallet 요약"><h3>Wallet · USDT</h3><dl>
    {([
      ["Wallet Balance",wallet.balance],["Equity",wallet.equity],["Available Balance",wallet.availableBalance],
      ["Used Margin",wallet.usedMargin],["Reserved Margin",wallet.reservedMargin],
      ["Unrealized PnL",wallet.unrealizedPnl],["Realized PnL",wallet.realizedPnl],
    ] as const).map(([label,value])=><div key={label}><dt>{label}</dt><dd data-trend={label.includes("PnL") ? pnlTrend(value) : undefined}>{formatDecimal(value)}</dd></div>)}
  </dl><p>서버 조회 기준 · {wallet.valuationStatus === "FRESH" ? "평가 정상" : "시세 평가 불가"}</p></section>;
}
