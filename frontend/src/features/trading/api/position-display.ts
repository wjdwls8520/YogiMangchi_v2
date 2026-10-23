import type { Position } from "./account";
import type { MarketPrice } from "../market/stream";
import { comparePrices } from "../market/price-format";
import { decimalUnits, unitsDecimal, validLimitPrice, validQuantity, validSizingPrice } from "./order-input";
import type { TradingOrder } from "./orders";
import type { TradingCommand } from "./mutation-request";

const SCALE = BigInt(10) ** BigInt(30);
function scaled(value: string) {
  if (!/^-?\d{1,40}(\.\d{1,30})?$/.test(value)) throw new Error("Invalid display decimal");
  const negative = value.startsWith("-"), [whole,fraction=""] = value.replace(/^-/,"").split(".");
  return (BigInt(whole)*SCALE+BigInt(fraction.padEnd(30,"0")))*(negative ? -BigInt(1) : BigInt(1));
}
function signed(value: bigint, scale: number) { return `${value < BigInt(0) ? "-" : ""}${unitsDecimal(value < BigInt(0) ? -value : value,scale)}`; }
// Display only: never written to account queries, Wallet, requests or server state.
export function positionValuation(position: Position, mark: MarketPrice | null | undefined, now=Date.now()) {
  if (!mark || (mark.expiresAt ?? 0)<=now || !validSizingPrice(mark.decimal)) return {mark:null,pnl:null,roe:null};
  try {
    const difference=scaled(mark.decimal)-scaled(position.entryPrice);
    const pnl=difference*scaled(position.quantity)*(position.side==="LONG" ? BigInt(1) : -BigInt(1));
    const margin=scaled(position.margin);
    return {mark:mark.decimal,pnl:signed(pnl,60),roe:margin>BigInt(0) ? signed(pnl*BigInt(10000)/(margin*SCALE),2) : null};
  } catch { return {mark:null,pnl:null,roe:null}; }
}
export function closePreset(free: string, percent: number) {
  if (!Number.isInteger(percent) || percent<1 || percent>100) return "";
  try { const result=unitsDecimal(decimalUnits(free)*BigInt(percent)/BigInt(100)/BigInt(10_000_000_000),8); return validQuantity(result) ? result : ""; }
  catch { return ""; }
}
export function closePreflight(position: Position, type: "MARKET"|"LIMIT", quantity: string, limitPrice: string, mark: MarketPrice | null | undefined, ready: boolean, now=Date.now()) {
  if (!ready || position.status!=="OPEN") return "거래할 계정과 포지션 상태를 확인해 주세요.";
  if (!validQuantity(position.freeCloseQuantity)) return "청산 가능한 수량이 없습니다. 예약된 청산 주문을 먼저 확인해 주세요.";
  if (!validQuantity(quantity)) return "청산 수량은 양수이며 소수점 8자리까지 입력할 수 있습니다.";
  if (comparePrices(quantity,position.freeCloseQuantity)>0) return "청산 가능 수량을 초과했습니다. 예약된 청산 주문을 먼저 확인해 주세요.";
  if (!mark || (mark.expiresAt ?? 0)<=now || !validSizingPrice(mark.decimal)) return "최신 Mark Price를 기다리고 있습니다. 시세 복구 후 청산해 주세요.";
  if (type==="LIMIT") {
    if (!validLimitPrice(limitPrice)) return "유효한 청산 지정가를 입력해 주세요. 소수점은 18자리까지 지원합니다.";
    const relation=comparePrices(limitPrice,mark.decimal);
    if (position.side==="LONG" ? relation<=0 : relation>=0) return position.side==="LONG"
      ? "롱 포지션의 청산 지정가는 현재 Mark Price보다 높아야 합니다." : "숏 포지션의 청산 지정가는 현재 Mark Price보다 낮아야 합니다.";
  }
  return null;
}
export function marketSubscriptionBatches(selected: number | null, positions: readonly number[]) {
  const ids=[...new Set([...(selected===null ? [] : [selected]),...positions])].filter(id=>Number.isSafeInteger(id)&&id>0);
  return Array.from({length:Math.ceil(ids.length/32)},(_,index)=>ids.slice(index*32,(index+1)*32));
}
export function positionCloseCommand(position:Position,type:"MARKET"|"LIMIT",quantity:string,limitPrice:string,mark:MarketPrice|null|undefined,ready:boolean,scope:"partial"|"available"|"full",now=Date.now()):{issue:string;command:null}|{issue:null;command:TradingCommand} {
  if (scope==="full" && (!validQuantity(quantity) || comparePrices(position.freeCloseQuantity,position.quantity)!==0 || comparePrices(quantity,position.quantity)!==0))
    return {issue:"전체 청산 전에 예약된 청산 주문을 취소해 주세요. 전체 보유 수량을 청산할 수 있어야 합니다.",command:null};
  const issue=closePreflight(position,type,quantity,limitPrice,mark,ready,now);
  if(issue) return {issue,command:null};
  if(scope==="partial" && comparePrices(quantity,position.quantity)>=0)
    return {issue:"부분 청산 수량은 전체 보유 수량보다 작아야 합니다. 전부 청산하려면 전체 청산을 선택해 주세요.",command:null};
  return {issue:null,command:type==="MARKET" ? {kind:"close",positionId:position.id,quantity} : {kind:"limitClose",positionId:position.id,quantity,limitPrice}};
}
export function liquidationUpdates(previous: number | null, orders: readonly TradingOrder[]) {
  return { newest: Math.max(previous??0,...orders.map(order=>order.orderId)),
    notices: previous===null ? [] : orders.filter(order=>order.orderId>previous&&order.action==="LIQUIDATE"&&order.status==="FILLED").slice(0,3) };
}
