"use client";

import { useTradingSummary } from "../api/queries";
import { formatDecimal } from "../api/account";
import { AccountQueryState } from "./account-query-state";

export function AccountWallet() {
  const query = useTradingSummary();
  return <>
    <dl className="order-wallet"><div><dt>사용 가능 자산</dt><dd>{formatDecimal(query.data?.wallet.availableBalance)} <span>USDT</span></dd></div></dl>
    <AccountQueryState loading={query.loading} error={query.error} onRetry={query.retry} busy={query.busy} />
    {query.stale && <p className="account-snapshot-note">최근 확인값입니다. 계정 조회 복구 전에는 신규 주문을 제출하지 않습니다.</p>}
    {query.data && query.data.wallet.valuationStatus !== "FRESH" && <p className="account-snapshot-note">자산 평가 갱신을 기다리는 중입니다.</p>}
  </>;
}
