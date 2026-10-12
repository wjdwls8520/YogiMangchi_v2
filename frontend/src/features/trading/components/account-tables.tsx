import { previewOrderHistory, previewPendingOrders } from "../preview-data";
import { formatDecimal, pnlTrend, symbolLabel, type Position } from "../api/account";
import type { TradingSymbol } from "../market/catalog";
import { TradingTable } from "./trading-table";

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
      action: <button type="button" disabled aria-label={`${symbolLabel(position.tradingSymbolId, symbols)} ${position.side} 포지션 청산 (미지원)`}>청산</button>,
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
