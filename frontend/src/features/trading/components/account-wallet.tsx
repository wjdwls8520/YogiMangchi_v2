"use client";

import { useTradingSummary } from "../api/queries";
import { formatDecimal } from "../api/account";
import { AccountQueryState } from "./account-query-state";

export function AccountWallet() {
  const query = useTradingSummary();
  return <>
    <dl className="order-wallet"><div><dt>사용 가능 자산</dt><dd>{formatDecimal(query.data?.wallet.availableBalance)} <span>USDT</span></dd></div></dl>
    <AccountQueryState loading={query.loading} error={query.error} onRetry={query.retry} busy={query.busy} />
    {query.data && <p className="account-snapshot-note">Guest #{query.data.accountId} · 조회 시점 기준{query.data.wallet.valuationStatus !== "FRESH" ? " · 시세 평가 불가" : ""}</p>}
  </>;
}
