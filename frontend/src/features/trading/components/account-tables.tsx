"use client";

import { useState } from "react";
import { knownOrderReason, orderReason } from "../api/order-reason";
import { orderStatusLabel, parseOrder, type TradingOrder } from "../api/orders";
import { formatDecimal, pnlTrend, symbolLabel, type Position } from "../api/account";
import type { TradingSymbol } from "../market/catalog";
import { LiquidationPrice } from "./liquidation-price";
import { TableQuantity } from "./table-quantity";
import { TradingTable, type TradingRow } from "./trading-table";
import { CancelOrderButton } from "./account-actions";
import { PositionStopLoss } from "./position-stop-loss";
import { PositionCloseEntry } from "./position-close-entry";
import { comparePrices, formatMarketPrice } from "../market/price-format";
import { useOptionalSelectedMarket, usePositionMarkets } from "./selected-market-provider";
import { positionValuation } from "../api/position-display";
import type { ClosedPositionHistory, FillHistory } from "../api/history";
import { useOptionalGuestSession } from "./trading-data-provider";
import type { GuestSession, SessionSnapshot } from "../api/guest-session";
import { useTradingMutation } from "../api/mutations";
import { useTradingSummary } from "../api/queries";
import {
  decimalUnits,
  estimatedOrderWithFee,
  formatEditableDecimal,
  suggestPassiveLimitPrice,
  validLimitPrice,
  validQuantity,
} from "../api/order-input";
import { passiveLimitIssueForAction, validatePendingOrderAmend } from "../api/order-preflight";
import { freshMarkPrice } from "../market/selected-market";

function quantity(value: string, symbolId: number, symbols: readonly TradingSymbol[], referencePrice?: string | null) {
  return <TableQuantity value={value} referencePrice={referencePrice} unit={symbols.find((symbol) => symbol.id === symbolId)?.symbol} />;
}
function side(value: string, leverage: number) {
  return <span className="table-side" data-side={value}>{value === "LONG" ? "Long" : "Short"} ×{leverage}</span>;
}
function price(value: string | null | undefined, symbolId: number, symbols: readonly TradingSymbol[]) {
  return formatMarketPrice(value, symbols.find((symbol) => symbol.id === symbolId)?.priceTickSize);
}
function kst(value: string) {
  return (
    <time dateTime={value}>
      {new Date(value).toLocaleString("sv-SE", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })}
    </time>
  );
}
function Result({ order }: { order: TradingOrder }) {
  const known = knownOrderReason(order.reason);
  const reason = order.status === "CANCELED"
    ? known
    : order.status === "REJECTED"
      ? known ?? "거절 사유를 확인할 수 없습니다. 주문 조건과 계정 상태를 확인해 주세요."
      : order.reason
        ? orderReason(order.reason)
        : null;
  return <span className="table-stack">{orderStatusLabel(order.status)}{reason && <small>{reason}</small>}</span>;
}

export async function readOrderSnapshot(
  session: Pick<GuestSession, "read">,
  snapshot: SessionSnapshot,
  orderId: number,
  signal: AbortSignal,
) {
  return parseOrder(await session.read(`account/orders/${orderId}`, snapshot, signal));
}

export function OrderSnapshotDetail({
  order,
  symbols,
  showSettlement = false,
  latest: initialLatest = null,
}: {
  order: TradingOrder;
  symbols: readonly TradingSymbol[];
  showSettlement?: boolean;
  latest?: TradingOrder | null;
}) {
  const context = useOptionalGuestSession();
  const [latest, setLatest] = useState<TradingOrder | null>(initialLatest);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  void symbols;
  async function refresh() {
    if (!context || loading || context.snapshot.phase !== "ready") return;
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    try {
      const next = await readOrderSnapshot(context.session, context.snapshot, order.orderId, controller.signal);
      setLatest(next);
    } catch {
      setError("단건 주문 상태를 조회하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      주문 #{order.orderId}<br />요청 배수 ×{order.requestedLeverage}
      {showSettlement && <><br />정산 조정 {formatDecimal(order.fill?.settlementAdjustment)} USDT</>}
      <br />
      <button type="button" className="account-refresh" disabled={loading || context?.snapshot.phase !== "ready"} onClick={() => void refresh()}>
        {loading ? "조회 중…" : "단건 상태 재조회"}
      </button>
      {error && <p role="alert" className="order-warning">{error}</p>}
      {latest && (
        <div role="status" className="account-snapshot-note">
          최신 상태: {orderStatusLabel(latest.status)} · 예약 증거금: {formatDecimal(latest.reservedMargin)} USDT · 예약 수수료: {formatDecimal(latest.reservedFee)} USDT · 수수료율: {formatDecimal(latest.feeRate)}
        </div>
      )}
    </>
  );
}

export function PositionTable({ positions, symbols }: { positions: readonly Position[]; symbols: readonly TradingSymbol[] }) {
  const prices = usePositionMarkets();
  return (
    <TradingTable
      caption="보유 포지션"
      variant="positions"
      columns={[
        { key: "symbol", label: "Symbol" },
        { key: "side", label: "Side" },
        { key: "size", label: "Quantity" },
        { key: "entry", label: "Entry Price" },
        { key: "mark", label: "Mark Price" },
        { key: "liquidation", label: "Liq. Price" },
        { key: "margin", label: "Margin" },
        { key: "pnl", label: "Unrealized PnL · ROE" },
        { key: "action", label: "Close" },
        { key: "stopLoss", label: "Stop Loss" },
      ]}
      rows={positions.map((position) => {
        const valuation = positionValuation(position, prices[position.tradingSymbolId]);
        return {
          id: String(position.id),
          cells: {
            symbol: (
              <span className="table-stack">
                <strong>{symbolLabel(position.tradingSymbolId, symbols)}</strong>
                <small>{position.marginMode === "ISOLATED" ? "Isolated" : "담보 전환 필요"}</small>
              </span>
            ),
            side: side(position.side, position.leverage),
            size: (
              <span className="table-stack">
                {quantity(position.quantity, position.tradingSymbolId, symbols, position.entryPrice)}
                <small>청산 예약: {formatEditableDecimal(position.reservedCloseQuantity) || "0"} · 포지션 #{position.id}</small>
              </span>
            ),
            entry: price(position.entryPrice, position.tradingSymbolId, symbols),
            mark: <span title={valuation.mark ? "최신 WS Mark · 참고" : "시세 만료 또는 수신 대기"}>{price(valuation.mark, position.tradingSymbolId, symbols)}</span>,
            liquidation: <LiquidationPrice value={position.liquidationPrice} status={position.liquidationPriceStatus} asOf={position.liquidationPriceAsOf} fresh={!!valuation.mark} />,
            margin: formatDecimal(position.margin),
            pnl: (
              <span className="table-stack" data-trend={pnlTrend(valuation.pnl)}>
                {formatDecimal(valuation.pnl)} USDT
                <small>{formatDecimal(valuation.roe)}% · 참고</small>
              </span>
            ),
            action: <PositionCloseEntry position={position} symbol={symbolLabel(position.tradingSymbolId, symbols)} layout="row" />,
            stopLoss: <PositionStopLoss position={position} symbol={symbolLabel(position.tradingSymbolId, symbols)} />,
          },
        };
      })}
    />
  );
}

type PendingEditState = {
  orderId: number;
  quantity: string;
  limitPrice: string;
};

function PendingOrderInteractiveBody({
  orders,
  symbols,
}: {
  orders: readonly TradingOrder[];
  symbols: readonly TradingSymbol[];
}) {
  const { snapshot } = useOptionalGuestSession()!;
  const summary = useTradingSummary();
  const amendAction = useTradingMutation();
  const selectedMarket = useOptionalSelectedMarket();
  const positionPrices = usePositionMarkets();
  const [edit, setEdit] = useState<PendingEditState | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  function resolveSymbolMark(symbolId: number): string | undefined {
    if (selectedMarket?.symbol?.id === symbolId) {
      return freshMarkPrice(selectedMarket.market)?.decimal;
    }
    const candidate = positionPrices[symbolId];
    if (!candidate) return undefined;
    return freshMarkPrice({ symbolId, state: "READY", recovery: 0, price: candidate })?.decimal;
  }

  function startEditing(order: TradingOrder) {
    amendAction.clearError();
    setLocalError(null);
    setEdit({
      orderId: order.orderId,
      quantity: formatEditableDecimal(order.quantity),
      limitPrice: formatEditableDecimal(order.limitPrice),
    });
  }

  function cancelEditing() {
    amendAction.clearError();
    setLocalError(null);
    setEdit(null);
  }

  async function saveAmend(order: TradingOrder) {
    if (!edit || edit.orderId !== order.orderId || amendAction.pending) return;
    setLocalError(null);
    const trimmedQty = edit.quantity.trim();
    const trimmedPrice = edit.limitPrice.trim();
    const markDecimal = resolveSymbolMark(order.tradingSymbolId);
    const targetPos = order.action === "CLOSE" && order.positionId != null
      ? summary.data?.positions.find((p) => p.id === order.positionId)
      : undefined;

    const issue = validatePendingOrderAmend({
      order,
      draftQuantity: trimmedQty,
      draftPrice: trimmedPrice,
      markPrice: markDecimal,
      availableBalance: summary.data?.wallet.availableBalance,
      positionFreeCloseQuantity: targetPos?.freeCloseQuantity,
    });
    if (issue) {
      setLocalError(issue.message);
      return;
    }

    const unchanged = order.limitPrice !== null
      && validQuantity(trimmedQty)
      && validLimitPrice(trimmedPrice)
      && decimalUnits(trimmedQty) === decimalUnits(order.quantity)
      && comparePrices(trimmedPrice, order.limitPrice) === 0;
    if (unchanged) {
      setEdit(null);
      return;
    }

    const updated = await amendAction.submit({
      kind: "amend",
      orderId: order.orderId,
      quantity: trimmedQty,
      limitPrice: trimmedPrice,
    });
    if (updated) {
      setEdit(null);
      setLocalError(null);
    }
  }

  const rows: TradingRow[] = orders.map((order) => {
    const isEditing = edit?.orderId === order.orderId && order.status === "PENDING";
    const sym = symbols.find((s) => s.id === order.tradingSymbolId);
    const symName = symbolLabel(order.tradingSymbolId, symbols);
    const unit = sym?.symbol ?? "수량";
    const markDecimal = isEditing ? resolveSymbolMark(order.tradingSymbolId) : undefined;
    const isClose = order.action === "CLOSE";
    const suggestedPassive = isEditing
      ? suggestPassiveLimitPrice(markDecimal, order.side as "LONG" | "SHORT", sym?.priceTickSize, isClose)
      : null;
    const crossingIssue = isEditing
      ? passiveLimitIssueForAction(order.side as "LONG" | "SHORT", order.action as "OPEN" | "CLOSE", edit.limitPrice.trim(), markDecimal)
      : null;
    const targetPos = isEditing && isClose && order.positionId != null
      ? summary.data?.positions.find((p) => p.id === order.positionId)
      : undefined;
    const liveIssue = isEditing
      ? validatePendingOrderAmend({
          order,
          draftQuantity: edit.quantity,
          draftPrice: edit.limitPrice,
          markPrice: markDecimal,
          availableBalance: summary.data?.wallet.availableBalance,
          positionFreeCloseQuantity: targetPos?.freeCloseQuantity,
        })
      : null;
    const previewOpen = isEditing && !isClose && validQuantity(edit.quantity.trim()) && validLimitPrice(edit.limitPrice.trim())
      ? estimatedOrderWithFee(edit.quantity.trim(), edit.limitPrice.trim(), order.leverage, "LIMIT")
      : null;

    return {
      id: String(order.orderId),
      cells: {
        orderId: `#${order.orderId}`,
        symbol: symName,
        side: side(order.side, order.leverage),
        requestedLeverage: `×${order.requestedLeverage}`,
        type: (
          <span className="table-stack">
            {order.type}
            <small>{order.action}</small>
          </span>
        ),
        quantity: isEditing ? (
          <div className="pending-amend-field">
            <div className="pending-amend-input-wrap">
              <input
                type="text"
                inputMode="decimal"
                aria-label={`${symName} 주문 #${order.orderId} 수정 수량`}
                value={edit.quantity}
                disabled={amendAction.pending}
                onChange={(e) => {
                  setLocalError(null);
                  setEdit((curr) => (curr && curr.orderId === order.orderId ? { ...curr, quantity: e.target.value } : curr));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); void saveAmend(order); }
                  if (e.key === "Escape") { e.preventDefault(); cancelEditing(); }
                }}
                className="pending-amend-input"
              />
              <span className="pending-amend-unit">{unit}</span>
            </div>
          </div>
        ) : (
          quantity(order.quantity, order.tradingSymbolId, symbols, order.limitPrice)
        ),
        price: isEditing ? (
          <div className="pending-amend-field">
            <div className="pending-amend-input-wrap">
              <input
                type="text"
                inputMode="decimal"
                aria-label={`${symName} 주문 #${order.orderId} 수정 지정가`}
                value={edit.limitPrice}
                disabled={amendAction.pending}
                onChange={(e) => {
                  setLocalError(null);
                  setEdit((curr) => (curr && curr.orderId === order.orderId ? { ...curr, limitPrice: e.target.value } : curr));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); void saveAmend(order); }
                  if (e.key === "Escape") { e.preventDefault(); cancelEditing(); }
                }}
                className="pending-amend-input"
              />
              <span className="pending-amend-unit">USDT</span>
            </div>
            {crossingIssue && suggestedPassive ? (
              <button
                type="button"
                className="pending-amend-chip"
                disabled={amendAction.pending}
                onClick={() => {
                  setLocalError(null);
                  setEdit((curr) => (curr && curr.orderId === order.orderId ? { ...curr, limitPrice: suggestedPassive } : curr));
                }}
              >
                가능 지정가({formatMarketPrice(suggestedPassive, sym?.priceTickSize)}) 맞춤
              </button>
            ) : null}
          </div>
        ) : (
          price(order.limitPrice, order.tradingSymbolId, symbols)
        ),
        reservedMargin: order.action === "OPEN" ? (
          <span className="table-stack">
            <span>{formatDecimal(order.reservedMargin)} USDT</span>
            {previewOpen && <small>변경 시 {formatDecimal(previewOpen.totalRequired)} USDT</small>}
          </span>
        ) : (
          <span className="table-stack">
            <span>청산 예약 {formatEditableDecimal(order.reservedCloseQuantity) || formatEditableDecimal(order.quantity)} {unit}</span>
            {isEditing && validQuantity(edit.quantity.trim()) && <small>변경 시 {edit.quantity.trim()} {unit}</small>}
          </span>
        ),
        reservedFee: order.action === "OPEN" ? (
          <span className="table-stack">
            <span>{formatDecimal(order.reservedFee)} USDT</span>
            {previewOpen && <small>변경 시 {formatDecimal(previewOpen.estimatedFee)} USDT</small>}
          </span>
        ) : (
          "—"
        ),
        feeRate: formatDecimal(order.feeRate),
        status: <Result order={order} />,
        time: kst(order.createdAt),
        action: isEditing ? (
          <div className="pending-amend-actions">
            <div className="pending-amend-buttons">
              <button
                type="button"
                className="pending-amend-save"
                disabled={amendAction.pending || snapshot.phase !== "ready" || Boolean(liveIssue)}
                aria-label={`${symName} 주문 #${order.orderId} 수정 저장`}
                onClick={() => void saveAmend(order)}
              >
                {amendAction.pending ? "저장 중…" : amendAction.unconfirmed ? "수정 재전송" : "저장"}
              </button>
              <button
                type="button"
                className="pending-amend-cancel"
                disabled={amendAction.pending}
                onClick={cancelEditing}
              >
                닫기
              </button>
            </div>
            {(localError || liveIssue?.message || amendAction.error) && (
              <p role="alert" className="pending-amend-error">
                {localError ?? liveIssue?.message ?? amendAction.error}
              </p>
            )}
          </div>
        ) : (
          <div className="pending-row-actions">
            {order.type === "LIMIT" && order.status === "PENDING" && (
              <button
                type="button"
                className="pending-amend-trigger"
                disabled={amendAction.pending || amendAction.blocked || snapshot.phase !== "ready"}
                aria-label={`${symName} 주문 #${order.orderId} 수정하기`}
                onClick={() => startEditing(order)}
              >
                수정하기
              </button>
            )}
            <CancelOrderButton orderId={order.orderId} symbol={symName} />
          </div>
        ),
      },
    };
  });

  return (
    <TradingTable
      caption="미체결 주문"
      variant="orders"
      columns={[
        { key: "orderId", label: "Order #" },
        { key: "symbol", label: "Symbol" },
        { key: "side", label: "Side" },
        { key: "requestedLeverage", label: "Req. Lev." },
        { key: "type", label: "Type / Action" },
        { key: "quantity", label: "Quantity" },
        { key: "price", label: "Limit Price" },
        { key: "reservedMargin", label: "Reserved Margin" },
        { key: "reservedFee", label: "Reserved Fee" },
        { key: "feeRate", label: "Fee Rate" },
        { key: "status", label: "Status" },
        { key: "time", label: "Created · KST" },
        { key: "action", label: "Modify / Cancel" },
      ]}
      rows={rows}
    />
  );
}

export function PendingOrderTable({ orders, symbols }: { orders: readonly TradingOrder[]; symbols: readonly TradingSymbol[] }) {
  const guest = useOptionalGuestSession();
  if (guest) {
    return <PendingOrderInteractiveBody orders={orders} symbols={symbols} />;
  }
  return (
    <TradingTable
      caption="미체결 주문"
      variant="orders"
      columns={[
        { key: "orderId", label: "Order #" },
        { key: "symbol", label: "Symbol" },
        { key: "side", label: "Side" },
        { key: "requestedLeverage", label: "Req. Lev." },
        { key: "type", label: "Type / Action" },
        { key: "quantity", label: "Quantity" },
        { key: "price", label: "Limit Price" },
        { key: "reservedMargin", label: "Reserved Margin" },
        { key: "reservedFee", label: "Reserved Fee" },
        { key: "feeRate", label: "Fee Rate" },
        { key: "status", label: "Status" },
        { key: "time", label: "Created · KST" },
        { key: "action", label: "Modify / Cancel" },
      ]}
      rows={orders.map((order) => ({
        id: String(order.orderId),
        cells: {
          orderId: `#${order.orderId}`,
          symbol: symbolLabel(order.tradingSymbolId, symbols),
          side: side(order.side, order.leverage),
          requestedLeverage: `×${order.requestedLeverage}`,
          type: (
            <span className="table-stack">
              {order.type}
              <small>{order.action}</small>
            </span>
          ),
          quantity: quantity(order.quantity, order.tradingSymbolId, symbols, order.limitPrice),
          price: price(order.limitPrice, order.tradingSymbolId, symbols),
          reservedMargin: order.action === "OPEN"
            ? `${formatDecimal(order.reservedMargin)} USDT`
            : `청산 예약 ${formatEditableDecimal(order.reservedCloseQuantity) || formatEditableDecimal(order.quantity)}`,
          reservedFee: order.action === "OPEN" ? `${formatDecimal(order.reservedFee)} USDT` : "—",
          feeRate: formatDecimal(order.feeRate),
          status: <Result order={order} />,
          time: kst(order.createdAt),
          action: (
            <div className="pending-row-actions">
              <button type="button" disabled>수정하기</button>
              <button type="button" disabled>취소</button>
            </div>
          ),
        },
      }))}
    />
  );
}

export function OrderHistoryTable({ orders, symbols }: { orders: readonly TradingOrder[]; symbols: readonly TradingSymbol[] }) {
  return (
    <TradingTable
      caption="주문 내역"
      variant="orders"
      columns={[
        { key: "orderId", label: "Order #" },
        { key: "symbol", label: "Symbol" },
        { key: "side", label: "Side" },
        { key: "requestedLeverage", label: "Req. Lev." },
        { key: "type", label: "Type / Action" },
        { key: "quantity", label: "Quantity" },
        { key: "price", label: "Fill / Order Price" },
        { key: "pnl", label: "Gross PnL / Fee" },
        { key: "feeRate", label: "Fee Rate" },
        { key: "reservedMargin", label: "Reserved Margin" },
        { key: "reservedFee", label: "Reserved Fee" },
        { key: "settlement", label: "Settlement Adj." },
        { key: "status", label: "Status / Reason" },
        { key: "time", label: "Filled / Created · KST" },
      ]}
      rows={orders.map((order) => ({
        id: String(order.orderId),
        cells: {
          orderId: `#${order.orderId}`,
          symbol: symbolLabel(order.tradingSymbolId, symbols),
          side: side(order.side, order.leverage),
          requestedLeverage: `×${order.requestedLeverage}`,
          type: (
            <span className="table-stack">
              {order.type}
              <small>{order.action === "LIQUIDATE" ? "강제청산" : order.action}</small>
            </span>
          ),
          quantity: quantity(order.quantity, order.tradingSymbolId, symbols, order.fill?.price ?? order.limitPrice),
          price: (
            <span className="table-stack">
              {price(order.fill?.price, order.tradingSymbolId, symbols)}
              <small>주문 {order.type === "MARKET" ? "시장가" : price(order.limitPrice, order.tradingSymbolId, symbols)}</small>
            </span>
          ),
          pnl: (
            <span className="table-stack">
              <span data-trend={pnlTrend(order.fill?.realizedPnl ?? null)}>{formatDecimal(order.fill?.realizedPnl)} USDT</span>
              <small>수수료 {formatDecimal(order.fill?.fee)}</small>
            </span>
          ),
          feeRate: formatDecimal(order.feeRate),
          reservedMargin: `${formatDecimal(order.reservedMargin)} USDT`,
          reservedFee: `${formatDecimal(order.reservedFee)} USDT`,
          settlement: `${formatDecimal(order.fill?.settlementAdjustment)} USDT`,
          status: <Result order={order} />,
          time: (
            <span className="table-stack">
              {order.fill ? kst(order.fill.executedAt) : "—"}
              <small>접수 {kst(order.createdAt)}</small>
            </span>
          ),
        },
      }))}
    />
  );
}

export function FillHistoryTable({ fills, symbols }: { fills: readonly FillHistory[]; symbols: readonly TradingSymbol[] }) {
  return (
    <TradingTable
      caption="체결 내역"
      variant="orders"
      columns={[
        { key: "orderPosId", label: "Order / Pos #" },
        { key: "symbol", label: "Symbol" },
        { key: "side", label: "Side / Action" },
        { key: "type", label: "Type" },
        { key: "quantity", label: "Quantity" },
        { key: "price", label: "Fill Price" },
        { key: "gross", label: "Gross PnL" },
        { key: "fee", label: "Fee" },
        { key: "settlement", label: "Settlement Adj." },
        { key: "marginMode", label: "Margin Mode" },
        { key: "time", label: "Filled · KST" },
      ]}
      rows={fills.map((fill) => ({
        id: String(fill.fillId),
        cells: {
          orderPosId: `#${fill.orderId} · #${fill.lifecyclePositionId}`,
          symbol: symbolLabel(fill.tradingSymbolId, symbols),
          side: (
            <span className="table-stack">
              {side(fill.side, fill.leverage)}
              <small>
                {fill.action === "LIQUIDATE"
                  ? "강제청산"
                  : fill.action === "CLOSE"
                    ? fill.reason === "STOP_LOSS"
                      ? "손절 청산"
                      : "청산"
                    : "진입"}
              </small>
            </span>
          ),
          type: fill.type,
          quantity: quantity(fill.quantity, fill.tradingSymbolId, symbols, fill.price),
          price: price(fill.price, fill.tradingSymbolId, symbols),
          gross: <span data-trend={pnlTrend(fill.realizedPnl)}>{formatDecimal(fill.realizedPnl)} USDT</span>,
          fee: `${formatDecimal(fill.fee)} USDT`,
          settlement: `${formatDecimal(fill.settlementAdjustment)} USDT`,
          marginMode: fill.marginMode,
          time: kst(fill.executedAt),
        },
      }))}
    />
  );
}

export function ClosedPositionTable({ positions, symbols }: { positions: readonly ClosedPositionHistory[]; symbols: readonly TradingSymbol[] }) {
  return (
    <TradingTable
      caption="종료 포지션 내역"
      variant="orders"
      columns={[
        { key: "symbol", label: "Symbol" },
        { key: "side", label: "Side" },
        { key: "status", label: "종료 상태" },
        { key: "quantity", label: "누적 진입 수량" },
        { key: "entry", label: "최종 잔여 평균 진입가" },
        { key: "exit", label: "마지막 체결가" },
        { key: "margin", label: "누적 투입 담보" },
        { key: "gross", label: "Gross PnL" },
        { key: "fees", label: "총 수수료" },
        { key: "adjustment", label: "정산 조정" },
        { key: "net", label: "Net PnL" },
        { key: "mode", label: "진입 / 종료 담보 방식" },
        { key: "opened", label: "진입 시각 (KST)" },
        { key: "time", label: "종료 시각 (KST)" },
      ]}
      rows={positions.map((position) => ({
        id: String(position.positionId),
        cells: {
          symbol: symbolLabel(position.tradingSymbolId, symbols),
          side: side(position.side, position.leverage),
          status: position.status,
          quantity: quantity(position.initialQuantity, position.tradingSymbolId, symbols, position.entryPrice),
          entry: price(position.entryPrice, position.tradingSymbolId, symbols),
          exit: price(position.exitPrice, position.tradingSymbolId, symbols),
          margin: `${formatDecimal(position.initialMargin)} USDT`,
          gross: <span data-trend={pnlTrend(position.realizedPnl)}>{formatDecimal(position.realizedPnl)} USDT</span>,
          fees: `${formatDecimal(position.feesPaid)} USDT`,
          adjustment: `${formatDecimal(position.settlementAdjustment)} USDT`,
          net: <span data-trend={pnlTrend(position.netRealizedPnl)}>{formatDecimal(position.netRealizedPnl)} USDT</span>,
          mode: `${position.openedMarginMode} / ${position.closingMarginMode}`,
          opened: kst(position.openedAt),
          time: kst(position.closedAt),
        },
      }))}
    />
  );
}
