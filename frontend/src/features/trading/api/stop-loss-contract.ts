import { decimal, id, instant, invalidContract, nullable, record } from "./contracts";
import { TradingApiError } from "./client";
import { validLimitPrice } from "./order-input";

export function parseStopLoss(value: unknown, positionId?: number, symbolId?:number, side?:string) {
  const row = record(value);
  if (!['NONE','ACTIVE','CANCELED','TRIGGERED','EXPIRED'].includes(String(row.status)) || !['LONG','SHORT'].includes(String(row.side))
    || !Number.isSafeInteger(row.version) || (row.version as number) < 0) return invalidContract();
  const result = { positionId:id(row.positionId), tradingSymbolId:id(row.tradingSymbolId), side:row.side as 'LONG'|'SHORT', status:row.status as 'NONE'|'ACTIVE'|'CANCELED'|'TRIGGERED'|'EXPIRED',
    stopPrice:nullable(row.stopPrice,decimal), version:row.version as number, updatedAt:nullable(row.updatedAt,instant), triggeredAt:nullable(row.triggeredAt,instant),
    priceEventTime:nullable(row.priceEventTime,instant), triggerPrice:nullable(row.triggerPrice,decimal), triggerOrderId:nullable(row.triggerOrderId,id), reason:row.reason === null ? null : row.reason === 'STOP_LOSS' ? 'STOP_LOSS' : null };
  if (positionId !== undefined && result.positionId !== positionId || symbolId !== undefined && result.tradingSymbolId !== symbolId || side !== undefined && result.side !== side) return invalidContract();
  if (result.status === 'NONE') {
    if (result.version !== 0 || [row.stopPrice,row.updatedAt,row.triggeredAt,row.priceEventTime,row.triggerPrice,row.triggerOrderId,row.reason].some(value=>value !== null)) return invalidContract();
  } else if (result.version <= 0 || !result.stopPrice || !validLimitPrice(result.stopPrice) || !result.updatedAt) return invalidContract();
  if (result.status === 'TRIGGERED' && (!result.triggeredAt || !result.priceEventTime || !result.triggerPrice || !validLimitPrice(result.triggerPrice) || !result.triggerOrderId || result.reason !== 'STOP_LOSS')) return invalidContract();
  return result;
}
export type StopLoss = ReturnType<typeof parseStopLoss>;
export function latestStopLoss(...values:(StopLoss|undefined)[]) {
  return values.reduce<StopLoss|undefined>((latest,value)=>!value || latest && (latest.positionId !== value.positionId || latest.tradingSymbolId !== value.tradingSymbolId || latest.side !== value.side || latest.version >= value.version) ? latest : value,undefined);
}
export type StopLossCommand = { positionId:number; expectedVersion:number; stopPrice?:string };
export function stopLossRequest(command:StopLossCommand) {
  if (!Number.isSafeInteger(command.positionId) || command.positionId <= 0 || !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 0 || command.stopPrice !== undefined && !validLimitPrice(command.stopPrice)) throw new TradingApiError(400,undefined,'INVALID_STOP_LOSS');
  const path = `account/positions/${command.positionId}/stop-loss`;
  return command.stopPrice === undefined ? {path:`${path}?expectedVersion=${command.expectedVersion}`,method:'DELETE' as const,body:undefined}
    : {path,method:'PUT' as const,body:{stopPrice:command.stopPrice,expectedVersion:command.expectedVersion}};
}
