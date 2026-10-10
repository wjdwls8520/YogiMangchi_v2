import { previewOrderHistory, previewPendingOrders, previewPositions } from "../preview-data";
import { TradingTable } from "./trading-table";

export function PositionTable() {
  return <TradingTable caption="포지션 예시" columns={[
    { key: "symbol", label: "Symbol" }, { key: "side", label: "Side" },
    { key: "size", label: "Size" }, { key: "entry", label: "Entry Price" },
    { key: "mark", label: "Mark Price" }, { key: "leverage", label: "Leverage" },
    { key: "pnl", label: "PnL" }, { key: "margin", label: "Margin" },
    { key: "action", label: "Close" },
  ]} rows={previewPositions.map((position) => ({
    id: position.id,
    cells: {
      symbol: position.symbol, side: <span data-side={position.side}>{position.side}</span>,
      size: position.size, entry: position.entryPrice, mark: position.markPrice,
      leverage: position.leverage, pnl: <span data-trend={position.trend}>{position.pnl}</span>,
      margin: position.margin,
      action: <button type="button" disabled aria-label={`${position.symbol} ${position.side} 포지션 청산 (미리보기)`}>청산</button>,
    },
  }))} />;
}

export function PendingOrderTable() {
  return <TradingTable caption="미체결 주문 예시" columns={[
    { key: "symbol", label: "Symbol" }, { key: "type", label: "Type" },
    { key: "side", label: "Side" }, { key: "quantity", label: "Quantity" },
    { key: "price", label: "Limit Price" }, { key: "status", label: "Status" },
    { key: "action", label: "Cancel" },
  ]} rows={previewPendingOrders.map((order) => ({
    id: order.id,
    cells: {
      symbol: order.symbol, type: order.type, side: <span data-side={order.side}>{order.side}</span>,
      quantity: order.quantity, price: order.limitPrice, status: order.status,
      action: <button type="button" disabled aria-label={`${order.symbol} 미체결 주문 취소 (미리보기)`}>취소</button>,
    },
  }))} />;
}

export function OrderHistoryTable() {
  return <TradingTable caption="주문 내역 예시" columns={[
    { key: "symbol", label: "Symbol" }, { key: "action", label: "Action" },
    { key: "type", label: "Type" }, { key: "quantity", label: "Quantity" },
    { key: "price", label: "Price" }, { key: "status", label: "Status" },
    { key: "time", label: "Time (KST)" },
  ]} rows={previewOrderHistory.map((order) => ({
    id: order.id,
    cells: {
      symbol: order.symbol, action: order.action, type: order.type,
      quantity: order.quantity, price: order.price, status: order.status,
      time: <time dateTime={`${order.time.replace(" ", "T")}+09:00`}>{order.time}</time>,
    },
  }))} />;
}
