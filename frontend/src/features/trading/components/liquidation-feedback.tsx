"use client";

import { useState } from "react";
import type { TradingOrder } from "../api/orders";
import type { TradingSymbol } from "../market/catalog";
import { symbolLabel } from "../api/account";
import { liquidationUpdates } from "../api/position-display";

export function LiquidationFeedback({ orders, identity, symbols }: { orders: readonly TradingOrder[] | undefined; identity: string; symbols: readonly TradingSymbol[] }) {
  const [stored,setStored]=useState<{identity:string;orders:readonly TradingOrder[]|undefined;newest:number|null;notices:readonly TradingOrder[]}>({identity,orders:undefined,newest:null,notices:[]});
  let current=stored;
  if (stored.identity!==identity) {current={identity,orders:undefined,newest:null,notices:[]};}
  if (orders && current.orders!==orders) {
    const update=liquidationUpdates(current.newest,orders);
    current={identity,orders,newest:update.newest,notices:[...update.notices,...current.notices].slice(0,3)};
  }
  if (current!==stored) setStored(current);
  return current.notices.length>0 ? <div role="status" className="liquidation-feedback">{current.notices.map(order=><p key={order.orderId}>{symbolLabel(order.tradingSymbolId,symbols)} {order.side} 포지션이 강제청산되었습니다. 주문 내역에서 체결 결과를 확인하세요.</p>)}</div> : null;
}
