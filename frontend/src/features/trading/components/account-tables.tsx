import { orderReason } from "../api/order-reason";
import type { TradingOrder } from "../api/orders";
import { formatDecimal, formatQuantity, pnlTrend, symbolLabel, type Position } from "../api/account";
import type { TradingSymbol } from "../market/catalog";
import { LiquidationPrice } from "./liquidation-price";
import { TradingTable } from "./trading-table";
import { CancelOrderButton } from "./account-actions";
import { PositionCloseEntry } from "./position-close-entry";
import { formatMarketPrice } from "../market/price-format";
import { useSelectedMarket } from "./selected-market-provider";
import { positionValuation } from "../api/position-display";
import type { ClosedPositionHistory, FillHistory } from "../api/history";

function price(value: string | null | undefined, symbolId: number, symbols: readonly TradingSymbol[]) {
  return formatMarketPrice(value, symbols.find((symbol) => symbol.id === symbolId)?.priceTickSize);
}

export function PositionTable({ positions, symbols }: { positions: readonly Position[]; symbols: readonly TradingSymbol[] }) {
  const {positionPrices}=useSelectedMarket();
  return <TradingTable caption="보유 포지션" variant="positions" columns={[
    { key: "symbol", label: "Symbol" }, { key: "side", label: "Side" },
    { key: "leverage", label: "Leverage" }, { key: "mode", label: "Margin Mode" },
    { key: "size", label: "Size" }, { key: "entry", label: "Entry Price" },
    { key: "mark", label: "Mark Price" },
    { key: "pnl", label: "미실현 PnL · 참고" }, { key: "roe", label: "ROE % · 참고" }, { key: "margin", label: "Margin" },
    { key: "reserved", label: "청산 예약 수량" }, { key: "liquidation", label: "강제청산가" },
    { key: "action", label: "Close" },
  ]} rows={positions.map((position) => {const valuation=positionValuation(position,positionPrices[position.tradingSymbolId]);return ({
    id: String(position.id),
    cells: {
      symbol: symbolLabel(position.tradingSymbolId, symbols), side: <span data-side={position.side}>{position.side}</span>,
      size: formatQuantity(position.quantity), entry: price(position.entryPrice, position.tradingSymbolId, symbols),
      mark: <span title={valuation.mark ? "최신 WS Mark · 참고" : "시세 만료 또는 수신 대기"}>{price(valuation.mark, position.tradingSymbolId, symbols)}{!valuation.mark && <small> · 시세 대기</small>}</span>,
      leverage: <span data-side={position.side}>{position.leverage}×</span>, pnl: <span data-trend={pnlTrend(valuation.pnl)}>{formatDecimal(valuation.pnl)} USDT</span>,
      roe:<span data-trend={pnlTrend(valuation.roe)}>{formatDecimal(valuation.roe)}%</span>,
      reserved:formatQuantity(position.reservedCloseQuantity), liquidation:<LiquidationPrice value={position.liquidationPrice} status={position.liquidationPriceStatus} asOf={position.liquidationPriceAsOf} fresh={!!valuation.mark}/>, mode: position.marginMode === "ISOLATED" ? "Isolated" : "담보 전환 필요",
      margin: formatDecimal(position.margin),
      action: <PositionCloseEntry position={position} symbol={symbolLabel(position.tradingSymbolId, symbols)} layout="row" />,
    },
  });})} />;
}

export function PendingOrderTable({ orders, symbols }: { orders: readonly TradingOrder[]; symbols: readonly TradingSymbol[] }) {
  return <TradingTable caption="미체결 주문" columns={[
    { key: "symbol", label: "Symbol" }, { key: "type", label: "Type" },
    { key: "intent", label: "Action" }, { key: "side", label: "Side" }, { key: "quantity", label: "Quantity" },
    { key: "leverage", label: "현재 / 요청 배수" }, { key: "price", label: "Limit Price" }, { key: "status", label: "Status" }, { key: "reason", label: "처리 사유" },
    { key: "time", label: "Created (KST)" },
    { key: "action", label: "Cancel" },
  ]} rows={orders.map((order) => ({
    id: String(order.orderId),
    cells: {
      symbol: symbolLabel(order.tradingSymbolId, symbols), type: order.type, intent: order.action, side: <span data-side={order.side}>{order.side}</span>,
      leverage: `${order.leverage}× / ${order.requestedLeverage}×`,
      quantity: formatQuantity(order.quantity), price: price(order.limitPrice, order.tradingSymbolId, symbols), status: order.status, reason: orderReason(order.reason),
      time:<time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}</time>,
      action: <CancelOrderButton orderId={order.orderId} symbol={symbolLabel(order.tradingSymbolId, symbols)} />,
    },
  }))} />;
}

export function OrderHistoryTable({ orders, symbols }: { orders: readonly TradingOrder[]; symbols: readonly TradingSymbol[] }) {
  return <TradingTable caption="주문 내역" columns={[
    { key: "symbol", label: "Symbol" }, { key: "action", label: "Action" },
    { key: "type", label: "Type" }, { key: "leverage", label: "체결 / 요청 배수" }, { key: "quantity", label: "Quantity" },
    { key: "requested", label: "Requested Price" },
    { key: "price", label: "Fill Price" }, { key: "status", label: "Status" }, { key: "reason", label: "처리 사유" },
    { key: "fee", label: "체결 수수료" }, { key: "adjustment", label: "서버 정산 조정" }, { key: "realized", label: "Gross PnL" }, {key:"filled",label:"Filled (KST)"},
    { key: "time", label: "Created (KST)" },
  ]} rows={orders.map((order) => ({
    id: String(order.orderId),
    cells: {
      symbol: symbolLabel(order.tradingSymbolId, symbols), action: `${order.action}${order.action==="LIQUIDATE" ? " · 강제청산" : ""} · ${order.side}`, type: order.type,
      leverage: `${order.leverage}× / ${order.requestedLeverage}×`,
      quantity: formatQuantity(order.quantity), price: price(order.fill?.price, order.tradingSymbolId, symbols), status: order.status, reason: orderReason(order.reason),
      requested:order.type==="MARKET" ? "시장가" : price(order.limitPrice,order.tradingSymbolId,symbols),
      fee: formatDecimal(order.fill?.fee), adjustment: formatDecimal(order.fill?.settlementAdjustment),
      realized:<span data-trend={pnlTrend(order.fill?.realizedPnl??null)}>{formatDecimal(order.fill?.realizedPnl)} USDT</span>,
      filled:order.fill ? <time dateTime={order.fill.executedAt}>{new Date(order.fill.executedAt).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}</time> : "—",
      time: <time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</time>,
    },
  }))} />;
}

function kst(value: string) {
  return <time dateTime={value}>{new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</time>;
}

export function FillHistoryTable({ fills, symbols }: { fills: readonly FillHistory[]; symbols: readonly TradingSymbol[] }) {
  return <TradingTable caption="체결 내역" columns={[
    { key: "symbol", label: "Symbol" }, { key: "side", label: "Side / Action" }, { key: "type", label: "Type" },
    { key: "quantity", label: "체결 수량" }, { key: "price", label: "체결가" }, { key: "leverage", label: "배수" },
    { key: "gross", label: "Gross PnL" }, { key: "fee", label: "수수료" }, { key: "adjustment", label: "정산 조정" },
    { key: "mode", label: "체결 담보 방식" }, { key: "order", label: "주문 / 포지션 ID" }, { key: "time", label: "체결 시각 (KST)" },
  ]} rows={fills.map(fill => ({ id: String(fill.fillId), cells: {
    symbol: symbolLabel(fill.tradingSymbolId, symbols), side: <span data-side={fill.side}>{fill.side} · {fill.action}</span>,
    type: fill.type, quantity: formatQuantity(fill.quantity), price: price(fill.price, fill.tradingSymbolId, symbols),
    leverage: <span data-side={fill.side}>{fill.leverage}×</span>,
    gross: <span data-trend={pnlTrend(fill.realizedPnl)}>{formatDecimal(fill.realizedPnl)} USDT</span>,
    fee: `${formatDecimal(fill.fee)} USDT`, adjustment: `${formatDecimal(fill.settlementAdjustment)} USDT`,
    mode: fill.marginMode, order: `${fill.orderId} / ${fill.lifecyclePositionId}`, time: kst(fill.executedAt),
  } }))} />;
}

export function ClosedPositionTable({ positions, symbols }: { positions: readonly ClosedPositionHistory[]; symbols: readonly TradingSymbol[] }) {
  return <TradingTable caption="종료 포지션 내역" columns={[
    { key: "symbol", label: "Symbol" }, { key: "side", label: "Side" }, { key: "status", label: "종료 상태" },
    { key: "quantity", label: "누적 진입 수량" }, { key: "entry", label: "최종 잔여 평균 진입가" },
    { key: "exit", label: "마지막 체결가" }, { key: "leverage", label: "배수" }, { key: "margin", label: "누적 투입 담보" },
    { key: "gross", label: "Gross PnL" }, { key: "fees", label: "총 수수료" }, { key: "adjustment", label: "정산 조정" },
    { key: "net", label: "Net PnL" }, { key: "mode", label: "진입 / 종료 담보 방식" },
    { key: "opened", label: "진입 시각 (KST)" }, { key: "time", label: "종료 시각 (KST)" },
  ]} rows={positions.map(position => ({ id: String(position.positionId), cells: {
    symbol: symbolLabel(position.tradingSymbolId, symbols), side: <span data-side={position.side}>{position.side}</span>,
    status: position.status, quantity: formatQuantity(position.initialQuantity),
    entry: price(position.entryPrice, position.tradingSymbolId, symbols), exit: price(position.exitPrice, position.tradingSymbolId, symbols),
    leverage: <span data-side={position.side}>{position.leverage}×</span>, margin: `${formatDecimal(position.initialMargin)} USDT`,
    gross: <span data-trend={pnlTrend(position.realizedPnl)}>{formatDecimal(position.realizedPnl)} USDT</span>,
    fees: `${formatDecimal(position.feesPaid)} USDT`, adjustment: `${formatDecimal(position.settlementAdjustment)} USDT`,
    net: <span data-trend={pnlTrend(position.netRealizedPnl)}>{formatDecimal(position.netRealizedPnl)} USDT</span>,
    mode: `${position.openedMarginMode} / ${position.closingMarginMode}`, opened: kst(position.openedAt), time: kst(position.closedAt),
  } }))} />;
}
