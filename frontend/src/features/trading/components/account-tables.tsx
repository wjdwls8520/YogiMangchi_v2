import type { ReactNode } from "react";
import { orderReason } from "../api/order-reason";
import { orderStatusLabel, type TradingOrder } from "../api/orders";
import { formatDecimal, pnlTrend, symbolLabel, type Position } from "../api/account";
import type { TradingSymbol } from "../market/catalog";
import { LiquidationPrice } from "./liquidation-price";
import { TableQuantity } from "./table-quantity";
import { TradingTable } from "./trading-table";
import { CancelOrderButton } from "./account-actions";
import { PositionStopLoss } from "./position-stop-loss";
import { PositionCloseEntry } from "./position-close-entry";
import { formatMarketPrice } from "../market/price-format";
import { usePositionMarkets } from "./selected-market-provider";
import { positionValuation } from "../api/position-display";
import type { ClosedPositionHistory, FillHistory } from "../api/history";

function quantity(value:string,symbolId:number,symbols:readonly TradingSymbol[],referencePrice?:string|null) { return <TableQuantity value={value} referencePrice={referencePrice} unit={symbols.find(symbol=>symbol.id===symbolId)?.symbol} />; }
function side(value:string,leverage:number) {return <span className="table-side" data-side={value}>{value==="LONG"?"Long":"Short"} ×{leverage}</span>;}
function price(value:string|null|undefined,symbolId:number,symbols:readonly TradingSymbol[]) {return formatMarketPrice(value,symbols.find(symbol=>symbol.id===symbolId)?.priceTickSize);}
function kst(value:string) {return <time dateTime={value}>{new Date(value).toLocaleString("sv-SE",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"})}</time>;}
function Detail({children}:{children:ReactNode}) {return <details className="table-record-detail"><summary>상세</summary><div>{children}</div></details>;}
function Result({order}:{order:TradingOrder}) {return <span className="table-stack">{orderStatusLabel(order.status)}{order.reason&&<small>{orderReason(order.reason)}</small>}</span>;}

export function PositionTable({positions,symbols}:{positions:readonly Position[];symbols:readonly TradingSymbol[]}) {
  const prices=usePositionMarkets();
  return <TradingTable caption="보유 포지션" variant="positions" columns={[
    {key:"symbol",label:"Symbol"},{key:"side",label:"Side"},{key:"size",label:"Quantity"},{key:"entry",label:"Entry Price"},{key:"mark",label:"Mark Price"},{key:"liquidation",label:"Liq. Price"},{key:"margin",label:"Margin"},{key:"pnl",label:"Unrealized PnL · ROE"},{key:"action",label:"Close"},{key:"stopLoss",label:"Stop Loss"},
  ]} rows={positions.map(position=>{const valuation=positionValuation(position,prices[position.tradingSymbolId]); return {id:String(position.id),cells:{
    symbol:<span className="table-stack"><strong>{symbolLabel(position.tradingSymbolId,symbols)}</strong><small>{position.marginMode==="ISOLATED"?"Isolated":"담보 전환 필요"}</small></span>,side:side(position.side,position.leverage),
    size:<>{quantity(position.quantity,position.tradingSymbolId,symbols,position.entryPrice)}<Detail>청산 예약: {quantity(position.reservedCloseQuantity,position.tradingSymbolId,symbols,position.entryPrice)}포지션 #{position.id}</Detail></>,
    entry:price(position.entryPrice,position.tradingSymbolId,symbols),mark:<span title={valuation.mark?"최신 WS Mark · 참고":"시세 만료 또는 수신 대기"}>{price(valuation.mark,position.tradingSymbolId,symbols)}</span>,
    liquidation:<LiquidationPrice value={position.liquidationPrice} status={position.liquidationPriceStatus} asOf={position.liquidationPriceAsOf} fresh={!!valuation.mark}/>,margin:formatDecimal(position.margin),
    pnl:<span className="table-stack" data-trend={pnlTrend(valuation.pnl)}>{formatDecimal(valuation.pnl)} USDT<small>{formatDecimal(valuation.roe)}% · 참고</small></span>,
    action:<PositionCloseEntry position={position} symbol={symbolLabel(position.tradingSymbolId,symbols)} layout="row"/>,stopLoss:<PositionStopLoss position={position} symbol={symbolLabel(position.tradingSymbolId,symbols)}/>,
  }};})}/>;
}
export function PendingOrderTable({orders,symbols}:{orders:readonly TradingOrder[];symbols:readonly TradingSymbol[]}) {
  return <TradingTable caption="미체결 주문" columns={[
    {key:"symbol",label:"Symbol"},{key:"side",label:"Side"},{key:"type",label:"Type / Action"},{key:"quantity",label:"Quantity"},{key:"price",label:"Limit Price"},{key:"status",label:"Status"},{key:"time",label:"Created · KST"},{key:"detail",label:"Details"},{key:"action",label:"Cancel"},
  ]} rows={orders.map(order=>({id:String(order.orderId),cells:{
    symbol:symbolLabel(order.tradingSymbolId,symbols),side:side(order.side,order.leverage),type:<span className="table-stack">{order.type}<small>{order.action}</small></span>,quantity:quantity(order.quantity,order.tradingSymbolId,symbols,order.limitPrice),price:price(order.limitPrice,order.tradingSymbolId,symbols),status:<Result order={order}/>,time:kst(order.createdAt),
    detail:<Detail>주문 #{order.orderId}<br/>요청 배수 ×{order.requestedLeverage}</Detail>,action:<CancelOrderButton orderId={order.orderId} symbol={symbolLabel(order.tradingSymbolId,symbols)}/>,
  }}))}/>;
}
export function OrderHistoryTable({orders,symbols}:{orders:readonly TradingOrder[];symbols:readonly TradingSymbol[]}) {
  return <TradingTable caption="주문 내역" columns={[
    {key:"symbol",label:"Symbol"},{key:"side",label:"Side"},{key:"type",label:"Type / Action"},{key:"quantity",label:"Quantity"},{key:"price",label:"Fill / Order Price"},{key:"status",label:"Status / Reason"},{key:"pnl",label:"Gross PnL / Fee"},{key:"time",label:"Filled / Created · KST"},{key:"detail",label:"Details"},
  ]} rows={orders.map(order=>({id:String(order.orderId),cells:{
    symbol:symbolLabel(order.tradingSymbolId,symbols),side:side(order.side,order.leverage),type:<span className="table-stack">{order.type}<small>{order.action==="LIQUIDATE"?"강제청산":order.action}</small></span>,quantity:quantity(order.quantity,order.tradingSymbolId,symbols,order.fill?.price??order.limitPrice),
    price:<span className="table-stack">{price(order.fill?.price,order.tradingSymbolId,symbols)}<small>주문 {order.type==="MARKET"?"시장가":price(order.limitPrice,order.tradingSymbolId,symbols)}</small></span>,status:<Result order={order}/>,
    pnl:<span className="table-stack"><span data-trend={pnlTrend(order.fill?.realizedPnl??null)}>{formatDecimal(order.fill?.realizedPnl)} USDT</span><small>수수료 {formatDecimal(order.fill?.fee)}</small></span>,
    time:<span className="table-stack">{order.fill?kst(order.fill.executedAt):"—"}<small>접수 {kst(order.createdAt)}</small></span>,detail:<Detail>주문 #{order.orderId}<br/>요청 배수 ×{order.requestedLeverage}<br/>정산 조정 {formatDecimal(order.fill?.settlementAdjustment)} USDT</Detail>,
  }}))}/>;
}
export function FillHistoryTable({fills,symbols}:{fills:readonly FillHistory[];symbols:readonly TradingSymbol[]}) {
  return <TradingTable caption="체결 내역" columns={[
    {key:"symbol",label:"Symbol"},{key:"side",label:"Side / Action"},{key:"type",label:"Type"},{key:"quantity",label:"Quantity"},{key:"price",label:"Fill Price"},{key:"gross",label:"Gross PnL"},{key:"fee",label:"Fee"},{key:"time",label:"Filled · KST"},{key:"detail",label:"Details"},
  ]} rows={fills.map(fill=>({id:String(fill.fillId),cells:{
    symbol:symbolLabel(fill.tradingSymbolId,symbols),side:<span className="table-stack">{side(fill.side,fill.leverage)}<small>{fill.action}</small></span>,type:fill.type,quantity:quantity(fill.quantity,fill.tradingSymbolId,symbols,fill.price),price:price(fill.price,fill.tradingSymbolId,symbols),gross:<span data-trend={pnlTrend(fill.realizedPnl)}>{formatDecimal(fill.realizedPnl)} USDT</span>,fee:`${formatDecimal(fill.fee)} USDT`,time:kst(fill.executedAt),detail:<Detail>주문 #{fill.orderId} · 포지션 #{fill.lifecyclePositionId}<br/>{fill.marginMode}<br/>정산 조정 {formatDecimal(fill.settlementAdjustment)} USDT</Detail>,
  }}))}/>;
}
export function ClosedPositionTable({ positions, symbols }: { positions: readonly ClosedPositionHistory[]; symbols: readonly TradingSymbol[] }) {
  return <TradingTable caption="종료 포지션 내역" columns={[
    { key: "symbol", label: "Symbol" }, { key: "side", label: "Side" }, { key: "status", label: "종료 상태" },
    { key: "quantity", label: "누적 진입 수량" }, { key: "entry", label: "최종 잔여 평균 진입가" },
    { key: "exit", label: "마지막 체결가" }, { key: "margin", label: "누적 투입 담보" },
    { key: "gross", label: "Gross PnL" }, { key: "fees", label: "총 수수료" }, { key: "adjustment", label: "정산 조정" },
    { key: "net", label: "Net PnL" }, { key: "mode", label: "진입 / 종료 담보 방식" },
    { key: "opened", label: "진입 시각 (KST)" }, { key: "time", label: "종료 시각 (KST)" },
  ]} rows={positions.map(position => ({ id: String(position.positionId), cells: {
    symbol: symbolLabel(position.tradingSymbolId, symbols), side: side(position.side, position.leverage),
    status: position.status, quantity: quantity(position.initialQuantity, position.tradingSymbolId, symbols, position.entryPrice),
    entry: price(position.entryPrice, position.tradingSymbolId, symbols), exit: price(position.exitPrice, position.tradingSymbolId, symbols),
    margin: `${formatDecimal(position.initialMargin)} USDT`,
    gross: <span data-trend={pnlTrend(position.realizedPnl)}>{formatDecimal(position.realizedPnl)} USDT</span>,
    fees: `${formatDecimal(position.feesPaid)} USDT`, adjustment: `${formatDecimal(position.settlementAdjustment)} USDT`,
    net: <span data-trend={pnlTrend(position.netRealizedPnl)}>{formatDecimal(position.netRealizedPnl)} USDT</span>,
    mode: `${position.openedMarginMode} / ${position.closingMarginMode}`, opened: kst(position.openedAt), time: kst(position.closedAt),
  } }))} />;
}
