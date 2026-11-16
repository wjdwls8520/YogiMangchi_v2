"use client";

import type { parseSummary } from "../api/account";
import { formatDecimal, pnlTrend } from "../api/account";

export function WalletOverview({ wallet, layout = "compact", stale = false }: { wallet: ReturnType<typeof parseSummary>["wallet"]; stale?: boolean; layout?: "compact" | "grid" }) {
  const rows = layout === "compact"
    ? ([
        ["Equity", "", wallet.equity],
        ["Available", "", wallet.availableBalance],
        ["Used Margin", "", wallet.usedMargin],
        ["Unrealized PnL", "", wallet.unrealizedPnl],
      ] as const)
    : ([
        ["Wallet Balance", "지갑 잔고", wallet.balance],
        ["Equity", "총 평가 자산", wallet.equity],
        ["Available Balance", "사용 가능 잔고", wallet.availableBalance],
        ["Used Margin", "사용 증거금", wallet.usedMargin],
        ["Reserved Margin", "주문 예약 증거금", wallet.reservedMargin],
        ["Unrealized PnL", "미실현 손익", wallet.unrealizedPnl],
        ["Realized PnL", "실현 손익(수수료 전)", wallet.realizedPnl],
        ["Fees Paid", "누적 수수료", wallet.feesPaid],
        ["Settlement Adjustment", "서버 정산 조정", wallet.settlementAdjustment],
      ] as const);
  return <section className="wallet-overview" data-layout={layout} aria-label="Wallet 요약"><h3>Account · USDT ({wallet.marginMode === "ISOLATED" ? "Isolated" : "담보 전환 필요"})</h3><dl>
    {rows.map(([label, meaning, value]) => <div key={label}><dt>{label}{layout === "grid" && meaning && <span className="wallet-label-meaning"> ({meaning})</span>}</dt><dd data-trend={label.includes("PnL") ? pnlTrend(value) : undefined}>{formatDecimal(value)}</dd></div>)}
    {layout === "grid" && <div><dt>평가 상태</dt><dd>{wallet.valuationStatus === "FRESH" ? "정상" : "시세 평가 불가"}</dd></div>}
  </dl>{(stale || wallet.valuationStatus !== "FRESH") && <p>{stale ? "자산 재조회 대기 중" : "시세 평가 갱신 대기 중"}</p>}</section>;
}
