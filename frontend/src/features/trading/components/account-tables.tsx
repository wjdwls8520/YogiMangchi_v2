import type { TradingOrder } from "../api/orders";
import { formatDecimal, pnlTrend, symbolLabel, type Position } from "../api/account";
import type { TradingSymbol } from "../market/catalog";
import { TradingTable } from "./trading-table";
import { CancelOrderButton, ClosePositionButton } from "./account-actions";

export function PositionTable({ positions, symbols }: { positions: readonly Position[]; symbols: readonly TradingSymbol[] }) {
  return <TradingTable caption="보유 포지션" variant="positions" columns={[
    { key: "symbol", label: "Symbol" }, { key: "side", label: "Side" },
    { key: "leverage", label: "Leverage" },
    { key: "size", label: "Size" }, { key: "entry", label: "Entry Price" },
    { key: "mark", label: "Mark Price" },
    { key: "pnl", label: "PnL" }, { key: "margin", label: "Margin" },
    { key: "action", label: "Close" },
  ]} rows={positions.map((position) => ({
    id: String(position.id),
    cells: {
      symbol: symbolLabel(position.tradingSymbolId, symbols), side: <span data-side={position.side}>{position.side}</span>,
      size: formatDecimal(position.quantity), entry: formatDecimal(position.entryPrice),
      mark: <span title={position.priceStatus}>{formatDecimal(position.markPrice)}</span>,
      leverage: `${position.leverage}×`, pnl: <span data-trend={pnlTrend(position.unrealizedPnl)}>{formatDecimal(position.unrealizedPnl)} USDT</span>,
      margin: formatDecimal(position.margin),
      action: <ClosePositionButton position={position} symbol={symbolLabel(position.tradingSymbolId, symbols)} />,
    },
  }))} />;
}

export function PendingOrderTable({ orders, symbols }: { orders: readonly TradingOrder[]; symbols: readonly TradingSymbol[] }) {
  return <TradingTable caption="미체결 주문" columns={[
    { key: "symbol", label: "Symbol" }, { key: "type", label: "Type" },
    { key: "intent", label: "Action" }, { key: "side", label: "Side" }, { key: "quantity", label: "Quantity" },
    { key: "price", label: "Limit Price" }, { key: "status", label: "Status" },
    { key: "action", label: "Cancel" },
  ]} rows={orders.map((order) => ({
    id: String(order.orderId),
    cells: {
      symbol: symbolLabel(order.tradingSymbolId, symbols), type: order.type, intent: order.action, side: <span data-side={order.side}>{order.side}</span>,
      quantity: formatDecimal(order.quantity), price: formatDecimal(order.limitPrice), status: order.status,
      action: <CancelOrderButton orderId={order.orderId} symbol={symbolLabel(order.tradingSymbolId, symbols)} />,
    },
  }))} />;
}

export function OrderHistoryTable({ orders, symbols }: { orders: readonly TradingOrder[]; symbols: readonly TradingSymbol[] }) {
  return <TradingTable caption="최근 주문 내역 최대 50건" columns={[
    { key: "symbol", label: "Symbol" }, { key: "action", label: "Action" },
    { key: "type", label: "Type" }, { key: "quantity", label: "Quantity" },
    { key: "price", label: "Fill Price" }, { key: "status", label: "Status" },
    { key: "time", label: "Created (KST)" },
  ]} rows={orders.map((order) => ({
    id: String(order.orderId),
    cells: {
      symbol: symbolLabel(order.tradingSymbolId, symbols), action: `${order.action} · ${order.side}`, type: order.type,
      quantity: formatDecimal(order.quantity), price: formatDecimal(order.fill?.price), status: order.status,
      time: <time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</time>,
    },
  }))} />;
}
