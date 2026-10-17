import type { TradingOrder } from "../api/orders";
import { formatDecimal, pnlTrend, symbolLabel, type Position } from "../api/account";
import type { TradingSymbol } from "../market/catalog";
import { TradingTable } from "./trading-table";
import { CancelOrderButton, ClosePositionButton } from "./account-actions";
import { formatMarketPrice } from "../market/price-format";
import { useSelectedMarket } from "./selected-market-provider";
import { positionValuation } from "../api/position-display";

function price(value: string | null | undefined, symbolId: number, symbols: readonly TradingSymbol[]) {
  return formatMarketPrice(value, symbols.find((symbol) => symbol.id === symbolId)?.priceTickSize);
}

export function PositionTable({ positions, symbols }: { positions: readonly Position[]; symbols: readonly TradingSymbol[] }) {
  const {positionPrices}=useSelectedMarket();
  return <TradingTable caption="보유 포지션" variant="positions" columns={[
    { key: "symbol", label: "Symbol" }, { key: "side", label: "Side" },
    { key: "leverage", label: "Leverage" },
    { key: "size", label: "Size" }, { key: "entry", label: "Entry Price" },
    { key: "mark", label: "Mark Price" },
    { key: "pnl", label: "미실현 PnL · 참고" }, { key: "roe", label: "ROE % · 참고" }, { key: "margin", label: "Margin" },
    { key: "reserved", label: "청산 예약 수량" }, { key: "free", label: "청산 가능 수량" },
    { key: "action", label: "Close" },
  ]} rows={positions.map((position) => {const valuation=positionValuation(position,positionPrices[position.tradingSymbolId]);return ({
    id: String(position.id),
    cells: {
      symbol: symbolLabel(position.tradingSymbolId, symbols), side: <span data-side={position.side}>{position.side}</span>,
      size: formatDecimal(position.quantity), entry: price(position.entryPrice, position.tradingSymbolId, symbols),
      mark: <span title={valuation.mark ? "최신 WS Mark · 참고" : "시세 만료 또는 수신 대기"}>{price(valuation.mark, position.tradingSymbolId, symbols)}{!valuation.mark && <small> · 시세 대기</small>}</span>,
      leverage: `${position.leverage}×`, pnl: <span data-trend={pnlTrend(valuation.pnl)}>{formatDecimal(valuation.pnl)} USDT</span>,
      roe:<span data-trend={pnlTrend(valuation.roe)}>{formatDecimal(valuation.roe)}%</span>,
      reserved:formatDecimal(position.reservedCloseQuantity), free:formatDecimal(position.freeCloseQuantity),
      margin: formatDecimal(position.margin),
      action: <ClosePositionButton position={position} symbol={symbolLabel(position.tradingSymbolId, symbols)} />,
    },
  });})} />;
}

export function PendingOrderTable({ orders, symbols }: { orders: readonly TradingOrder[]; symbols: readonly TradingSymbol[] }) {
  return <TradingTable caption="미체결 주문" columns={[
    { key: "symbol", label: "Symbol" }, { key: "type", label: "Type" },
    { key: "intent", label: "Action" }, { key: "side", label: "Side" }, { key: "quantity", label: "Quantity" },
    { key: "price", label: "Limit Price" }, { key: "status", label: "Status" },
    { key: "time", label: "Created (KST)" },
    { key: "action", label: "Cancel" },
  ]} rows={orders.map((order) => ({
    id: String(order.orderId),
    cells: {
      symbol: symbolLabel(order.tradingSymbolId, symbols), type: order.type, intent: order.action, side: <span data-side={order.side}>{order.side}</span>,
      quantity: formatDecimal(order.quantity), price: price(order.limitPrice, order.tradingSymbolId, symbols), status: order.status,
      time:<time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}</time>,
      action: <CancelOrderButton orderId={order.orderId} symbol={symbolLabel(order.tradingSymbolId, symbols)} />,
    },
  }))} />;
}

export function OrderHistoryTable({ orders, symbols }: { orders: readonly TradingOrder[]; symbols: readonly TradingSymbol[] }) {
  return <TradingTable caption="최근 주문 내역 최대 50건" columns={[
    { key: "symbol", label: "Symbol" }, { key: "action", label: "Action" },
    { key: "type", label: "Type" }, { key: "quantity", label: "Quantity" },
    { key: "requested", label: "Requested Price" },
    { key: "price", label: "Fill Price" }, { key: "status", label: "Status" },
    { key: "realized", label: "Realized PnL" }, {key:"filled",label:"Filled (KST)"},
    { key: "time", label: "Created (KST)" },
  ]} rows={orders.map((order) => ({
    id: String(order.orderId),
    cells: {
      symbol: symbolLabel(order.tradingSymbolId, symbols), action: `${order.action}${order.action==="LIQUIDATE" ? " · 강제청산" : ""} · ${order.side}`, type: order.type,
      quantity: formatDecimal(order.quantity), price: price(order.fill?.price, order.tradingSymbolId, symbols), status: order.status,
      requested:order.type==="MARKET" ? "시장가" : price(order.limitPrice,order.tradingSymbolId,symbols),
      realized:<span data-trend={pnlTrend(order.fill?.realizedPnl??null)}>{formatDecimal(order.fill?.realizedPnl)} USDT</span>,
      filled:order.fill ? <time dateTime={order.fill.executedAt}>{new Date(order.fill.executedAt).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}</time> : "—",
      time: <time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</time>,
    },
  }))} />;
}
