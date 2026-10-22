import { decimal, id, instant, invalidContract, record } from "./contracts";

export function parseGuestRetry(value: unknown, accountId: number) {
  const row=record(value);
  if(id(row.accountId)!==accountId||row.status!=="ACTIVE"||row.quoteAsset!=="USDT")return invalidContract();
  for(const count of [row.canceledOrderCount,row.closedPositionCount])if(!Number.isSafeInteger(count)||(count as number)<0)return invalidContract();
  return {retryId:id(row.retryId),accountId,status:"ACTIVE" as const,balance:decimal(row.balance),
    canceledOrderCount:row.canceledOrderCount as number,closedPositionCount:row.closedPositionCount as number,resetAt:instant(row.resetAt)};
}
