"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { knownOrderReason, orderReason } from "../api/order-reason";
import { orderStatusLabel, parseOrder, type TradingOrder } from "../api/orders";
import { formatDecimal, pnlTrend, symbolLabel, type Position } from "../api/account";
import type { TradingSymbol } from "../market/catalog";
import { LiquidationPrice } from "./liquidation-price";
import { TableQuantity } from "./table-quantity";
import { TradingTable, type TradingRow } from "./trading-table";
import { CancelOrderButton } from "./account-actions";
import { PositionStopLoss } from "./position-stop-loss";
import { PositionTakeProfit } from "./position-take-profit";
import { PositionCloseEntry } from "./position-close-entry";
import { useTradingNotices } from "./trading-notices";
import { tradingKeys } from "../api/query-keys";
import { mutationMessage } from "../api/mutation-request";
import { useTradingAdmission } from "../api/recovery";
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
  stepDecimalPrice,
  suggestPassiveLimitPrice,
  unitsDecimal,
  validLimitPrice,
  validQuantity,
} from "../api/order-input";
import { passiveLimitIssueForAction, validatePendingOrderAmend } from "../api/order-preflight";
import { freshMarkPrice } from "../market/selected-market";
import { useDialogScrollLock } from "../../member/components/dim-modal";
import { formatOrderTypeKr, formatPositionStatusKr } from "../../../lib/labels";

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

function CloseAllPositionsButton({ count }: { count: number }) {
  const guest = useOptionalGuestSession();
  const client = useQueryClient();
  const notices = useTradingNotices();
  const admission = useTradingAdmission();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useDialogScrollLock(dialog, false, { canClose: () => !pending });

  if (!guest || count === 0) return null;
  const { session, snapshot } = guest;

  async function confirmCloseAll() {
    if (pending || snapshot.phase !== "ready" || !admission.trade) return;
    setPending(true);
    setError(null);
    try {
      const result = await session.closeAllPositions(snapshot);
      dialog.current?.close();
      notices.push({
        kind: "success",
        title: "전체 포지션 청산 완료",
        message: `${result.closedCount}개 포지션이 시장가로 청산되었습니다.`,
      });
      void client.invalidateQueries({ queryKey: tradingKeys.account(snapshot) });
    } catch (err) {
      setError(mutationMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="batch-action-bar">
      <button
        ref={trigger}
        type="button"
        className="batch-action-danger"
        disabled={snapshot.phase !== "ready" || snapshot.retrying || !admission.trade || pending}
        onClick={() => {
          setError(null);
          dialog.current?.showModal();
        }}
      >
        전체 청산 ({count})
      </button>
      <dialog
        ref={dialog}
        className="position-close-dialog ym-exchange-modal"
        aria-modal="true"
        aria-labelledby="close-all-positions-title"
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
        onClose={() => {
          setError(null);
          trigger.current?.focus({ preventScroll: true });
        }}
      >
        <header className="ym-modal-header">
          <h2 id="close-all-positions-title">전체 포지션 시장가 청산</h2>
          <button type="button" className="ym-modal-close" aria-label="닫기" disabled={pending} onClick={() => dialog.current?.close()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <p className="ym-modal-subtle">
          보유 중인 모든 오픈 포지션 {count}건의 예약 청산 주문을 취소하고, 현재 서버 Mark Price 기준으로 즉시 시장가 청산합니다.
        </p>
        {error && <p role="alert" className="ym-modal-alert mt-3">{error}</p>}
        <div className="ym-modal-footer mt-4">
          <button type="button" className="ym-modal-btn-cancel" disabled={pending} onClick={() => dialog.current?.close()}>
            취소
          </button>
          <button type="button" className="ym-modal-btn-confirm" disabled={pending} onClick={() => void confirmCloseAll()}>
            {pending ? "청산 중…" : "전체 청산 확인"}
          </button>
        </div>
      </dialog>
    </div>
  );
}

function CancelAllOrdersButton({ count }: { count: number }) {
  const guest = useOptionalGuestSession();
  const client = useQueryClient();
  const notices = useTradingNotices();
  const admission = useTradingAdmission();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useDialogScrollLock(dialog, false, { canClose: () => !pending });

  if (!guest || count === 0) return null;
  const { session, snapshot } = guest;

  async function confirmCancelAll() {
    if (pending || snapshot.phase !== "ready" || !admission.cancel) return;
    setPending(true);
    setError(null);
    try {
      const result = await session.cancelAllOrders(snapshot);
      dialog.current?.close();
      notices.push({
        kind: "success",
        title: "미체결 주문 전체 취소 완료",
        message: `${result.canceledCount}건의 미체결 주문이 취소되었습니다.`,
      });
      void client.invalidateQueries({ queryKey: tradingKeys.account(snapshot) });
    } catch (err) {
      setError(mutationMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="batch-action-bar">
      <button
        ref={trigger}
        type="button"
        className="batch-action-warning"
        disabled={snapshot.phase !== "ready" || snapshot.retrying || !admission.cancel || pending}
        onClick={() => {
          setError(null);
          dialog.current?.showModal();
        }}
      >
        전체 취소 ({count})
      </button>
      <dialog
        ref={dialog}
        className="position-close-dialog ym-exchange-modal"
        aria-modal="true"
        aria-labelledby="cancel-all-orders-title"
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
        onClose={() => {
          setError(null);
          trigger.current?.focus({ preventScroll: true });
        }}
      >
        <header className="ym-modal-header">
          <h2 id="cancel-all-orders-title">미체결 주문 전체 취소</h2>
          <button type="button" className="ym-modal-close" aria-label="닫기" disabled={pending} onClick={() => dialog.current?.close()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <p className="ym-modal-subtle">
          현재 대기 중인 미체결 주문 {count}건을 모두 취소하고 예약된 증거금·청산 수량을 해제합니다.
        </p>
        {error && <p role="alert" className="ym-modal-alert mt-3">{error}</p>}
        <div className="ym-modal-footer mt-4">
          <button type="button" className="ym-modal-btn-cancel" disabled={pending} onClick={() => dialog.current?.close()}>
            취소
          </button>
          <button type="button" className="ym-modal-btn-confirm" disabled={pending} onClick={() => void confirmCancelAll()}>
            {pending ? "취소 중…" : "전체 취소 확인"}
          </button>
        </div>
      </dialog>
    </div>
  );
}

export function PositionTable({ positions, symbols }: { positions: readonly Position[]; symbols: readonly TradingSymbol[] }) {
  const prices = usePositionMarkets();
  return (
    <>
      <CloseAllPositionsButton count={positions.length} />
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
          { key: "stopLoss", label: "TP / SL" },
        ]}
        rows={positions.map((position) => {
          const valuation = positionValuation(position, prices[position.tradingSymbolId]);
          const symLabel = symbolLabel(position.tradingSymbolId, symbols);
          const tick = symbols.find((s) => s.id === position.tradingSymbolId)?.priceTickSize;
          return {
            id: String(position.id),
            cells: {
              symbol: (
                <span className="table-stack">
                  <strong>{symLabel}</strong>
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
                  <small>{formatDecimal(valuation.roe)}%</small>
                </span>
              ),
              action: <PositionCloseEntry position={position} symbol={symLabel} layout="row" />,
              stopLoss: (
                <div className="position-tpsl-actions">
                  <PositionTakeProfit position={position} symbol={symLabel} priceTickSize={tick} />
                  <PositionStopLoss position={position} symbol={symLabel} priceTickSize={tick} />
                </div>
              ),
            },
          };
        })}
      />
    </>
  );
}

export function PendingOrderAmend({
  order,
  symbol,
  symbolMeta,
}: {
  order: TradingOrder;
  symbol: string;
  symbolMeta?: TradingSymbol;
}) {
  const { snapshot } = useOptionalGuestSession()!;
  const summary = useTradingSummary();
  const amendAction = useTradingMutation(undefined, undefined, { suppressErrorNotice: true });
  const selectedMarket = useOptionalSelectedMarket();
  const positionPrices = usePositionMarkets();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [draftQty, setDraftQty] = useState(() => formatEditableDecimal(order.quantity));
  const [draftPrice, setDraftPrice] = useState(() => formatEditableDecimal(order.limitPrice));
  const [localError, setLocalError] = useState<string | null>(null);
  useDialogScrollLock(dialog, false, { canClose: () => !amendAction.pending });

  const unit = symbolMeta?.symbol ?? symbol.split(" /")[0] ?? "수량";
  const isClose = order.action === "CLOSE";

  function resolveSymbolMark(symbolId: number): string | undefined {
    if (selectedMarket?.symbol?.id === symbolId) {
      return freshMarkPrice(selectedMarket.market)?.decimal;
    }
    const candidate = positionPrices[symbolId];
    if (!candidate) return undefined;
    return freshMarkPrice({ symbolId, state: "READY", recovery: 0, price: candidate })?.decimal;
  }

  function openDialog() {
    if (snapshot.phase !== "ready" || dialog.current?.open) return;
    amendAction.clearError();
    setLocalError(null);
    setDraftQty(formatEditableDecimal(order.quantity));
    setDraftPrice(formatEditableDecimal(order.limitPrice));
    setOpen(true);
    dialog.current?.showModal();
  }

  function closeDialog() {
    if (amendAction.pending) return;
    amendAction.clearError();
    setLocalError(null);
    dialog.current?.close();
  }

  const markDecimal = open ? resolveSymbolMark(order.tradingSymbolId) : undefined;
  const targetPos = open && isClose && order.positionId != null
    ? summary.data?.positions.find((p) => p.id === order.positionId)
    : undefined;
  const suggestedPassive = open
    ? suggestPassiveLimitPrice(markDecimal, order.side as "LONG" | "SHORT", symbolMeta?.priceTickSize, isClose)
    : null;
  const crossingIssue = open
    ? passiveLimitIssueForAction(order.side as "LONG" | "SHORT", order.action as "OPEN" | "CLOSE", draftPrice.trim(), markDecimal)
    : null;
  const liveIssue = open
    ? validatePendingOrderAmend({
        order,
        draftQuantity: draftQty,
        draftPrice,
        markPrice: markDecimal,
        availableBalance: summary.data?.wallet.availableBalance,
        positionFreeCloseQuantity: targetPos?.freeCloseQuantity,
      })
    : null;
  const previewOpen = open && !isClose && validQuantity(draftQty.trim()) && validLimitPrice(draftPrice.trim())
    ? estimatedOrderWithFee(draftQty.trim(), draftPrice.trim(), order.leverage, "LIMIT")
    : null;

  async function submitAmend() {
    if (amendAction.pending || snapshot.phase !== "ready") return;
    setLocalError(null);
    if (amendAction.unconfirmed) {
      const retried = await amendAction.retry();
      if (retried) dialog.current?.close();
      return;
    }
    const trimmedQty = draftQty.trim();
    const trimmedPrice = draftPrice.trim();
    const latestMark = resolveSymbolMark(order.tradingSymbolId);
    const issue = validatePendingOrderAmend({
      order,
      draftQuantity: trimmedQty,
      draftPrice: trimmedPrice,
      markPrice: latestMark,
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
      dialog.current?.close();
      return;
    }
    const updated = await amendAction.submit({
      kind: "amend",
      orderId: order.orderId,
      quantity: trimmedQty,
      limitPrice: trimmedPrice,
    });
    if (updated) {
      setLocalError(null);
      dialog.current?.close();
    }
  }

  const maxCloseUnits = open && isClose && targetPos?.freeCloseQuantity != null
    ? (() => {
        try {
          return formatEditableDecimal(
            unitsDecimal(decimalUnits(targetPos.freeCloseQuantity) + decimalUnits(order.quantity), 18),
          );
        } catch {
          return null;
        }
      })()
    : null;

  return (
    <div className="pending-order-amend">
      <button
        ref={trigger}
        type="button"
        className="pending-amend-trigger whitespace-nowrap shrink-0"
        aria-haspopup="dialog"
        aria-label={`${symbol} 주문 #${order.orderId} 수정하기`}
        disabled={amendAction.pending || (!amendAction.unconfirmed && amendAction.blocked) || snapshot.phase !== "ready"}
        onClick={openDialog}
      >
        수정하기
      </button>
      <dialog
        ref={dialog}
        className="position-close-dialog pending-amend-dialog ym-exchange-modal"
        aria-modal="true"
        aria-labelledby={`amend-order-${order.orderId}`}
        onClick={(event) => {
          if (event.target === event.currentTarget && event.detail < 2 && !amendAction.pending) {
            closeDialog();
          }
        }}
        onCancel={(event) => {
          if (amendAction.pending) event.preventDefault();
        }}
        onClose={() => {
          setOpen(false);
          setLocalError(null);
          trigger.current?.focus({ preventScroll: true });
        }}
      >
        <header className="ym-modal-header">
          <div className="ym-modal-title-group">
            <h2 id={`amend-order-${order.orderId}`}>주문 수정</h2>
            <span className="ym-modal-badge" data-side={order.side}>
              {unit}USDT · {order.side === "LONG" ? "Long" : "Short"} {order.leverage}× · #{order.orderId}
            </span>
          </div>
          <button type="button" className="ym-modal-close" aria-label="닫기" disabled={amendAction.pending} onClick={closeDialog}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <dl className="ym-modal-kv-list">
          <div>
            <dt>Order Price</dt>
            <dd>{formatMarketPrice(order.limitPrice, symbolMeta?.priceTickSize)}</dd>
          </div>
          <div>
            <dt>Mark Price</dt>
            <dd>{formatMarketPrice(markDecimal, symbolMeta?.priceTickSize)}</dd>
          </div>
          <div>
            <dt>{isClose ? "Max Close Qty" : "Available"}</dt>
            <dd className="ym-modal-liq">
              {isClose
                ? (maxCloseUnits ? `${maxCloseUnits} ${unit}` : `${formatEditableDecimal(order.quantity)} ${unit}`)
                : `${formatDecimal(summary.data?.wallet.availableBalance)} USDT`}
            </dd>
          </div>
        </dl>

        <form
          className="ym-modal-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submitAmend();
          }}
        >
          <div className="ym-modal-field">
            <div className="ym-modal-field-head">
              <label htmlFor={`amend-price-${order.orderId}`}>
                Limit Price <span>USDT</span>
              </label>
              {suggestedPassive && (
                <button
                  type="button"
                  className="pending-amend-chip"
                  disabled={amendAction.pending}
                  onClick={() => {
                    setLocalError(null);
                    setDraftPrice(suggestedPassive);
                  }}
                >
                  {crossingIssue
                    ? `가능가(${formatMarketPrice(suggestedPassive, symbolMeta?.priceTickSize)}) 맞춤`
                    : `Mark 기준 (${formatMarketPrice(suggestedPassive, symbolMeta?.priceTickSize)})`}
                </button>
              )}
            </div>
            <div className="ym-modal-stepper-box">
              <input
                id={`amend-price-${order.orderId}`}
                inputMode="decimal"
                autoComplete="off"
                value={draftPrice}
                disabled={amendAction.pending || amendAction.unconfirmed}
                placeholder={formatEditableDecimal(order.limitPrice) || "가격 입력"}
                onChange={(event) => {
                  setLocalError(null);
                  setDraftPrice(event.target.value);
                }}
              />
              <div className="ym-modal-steppers">
                <button
                  type="button"
                  aria-label="지정가 내리기"
                  disabled={amendAction.pending || amendAction.unconfirmed}
                  onClick={() => {
                    const next = stepDecimalPrice(draftPrice, order.limitPrice ?? markDecimal, symbolMeta?.priceTickSize, -1);
                    if (next) {
                      setLocalError(null);
                      setDraftPrice(next);
                    }
                  }}
                >
                  −
                </button>
                <i aria-hidden="true" />
                <button
                  type="button"
                  aria-label="지정가 올리기"
                  disabled={amendAction.pending || amendAction.unconfirmed}
                  onClick={() => {
                    const next = stepDecimalPrice(draftPrice, order.limitPrice ?? markDecimal, symbolMeta?.priceTickSize, 1);
                    if (next) {
                      setLocalError(null);
                      setDraftPrice(next);
                    }
                  }}
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <div className="ym-modal-field">
            <div className="ym-modal-field-head">
              <label htmlFor={`amend-qty-${order.orderId}`}>
                Qty <span>{unit}</span>
              </label>
              <span className="ym-modal-field-meta">
                기존 <strong>{formatEditableDecimal(order.quantity)}</strong> {unit}
              </span>
            </div>
            <div className="ym-modal-stepper-box">
              <input
                id={`amend-qty-${order.orderId}`}
                inputMode="decimal"
                autoComplete="off"
                value={draftQty}
                disabled={amendAction.pending || amendAction.unconfirmed}
                placeholder={formatEditableDecimal(order.quantity) || "수량 입력"}
                onChange={(event) => {
                  setLocalError(null);
                  setDraftQty(event.target.value);
                }}
              />
            </div>
          </div>

          {!isClose && previewOpen && (
            <div className="ym-modal-estimate">
              <span>
                기존 예약 <strong>{formatDecimal(order.reservedMargin)} USDT</strong>
              </span>
              <span>
                수정 후 <strong>{formatDecimal(previewOpen.totalRequired)} USDT</strong>
              </span>
            </div>
          )}

          {(localError || liveIssue?.message || amendAction.error) && (
            <p role="alert" className="ym-modal-alert">
              {localError ?? liveIssue?.message ?? amendAction.error}
            </p>
          )}

          <div className="ym-modal-footer">
            <button type="button" className="ym-modal-btn-cancel" disabled={amendAction.pending} onClick={closeDialog}>
              취소
            </button>
            <button
              type="submit"
              className="ym-modal-btn-confirm"
              disabled={amendAction.pending || (!amendAction.unconfirmed && Boolean(liveIssue))}
            >
              {amendAction.pending ? "처리 중…" : amendAction.unconfirmed ? "수정 요청 재전송" : "주문 수정"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

function PendingOrderInteractiveBody({
  orders,
  symbols,
}: {
  orders: readonly TradingOrder[];
  symbols: readonly TradingSymbol[];
}) {
  const rows: TradingRow[] = orders.map((order) => {
    const sym = symbols.find((s) => s.id === order.tradingSymbolId);
    const symName = symbolLabel(order.tradingSymbolId, symbols);
    const unit = sym?.symbol ?? "수량";

    return {
      id: String(order.orderId),
      cells: {
        orderId: `#${order.orderId}`,
        symbol: symName,
        side: side(order.side, order.leverage),
        requestedLeverage: `×${order.requestedLeverage}`,
        type: (
          <span className="table-stack">
            {formatOrderTypeKr(order.type)}
            <small>{order.action === "OPEN" ? "진입" : order.action === "CLOSE" ? "청산" : "강제청산"}</small>
          </span>
        ),
        quantity: quantity(order.quantity, order.tradingSymbolId, symbols, order.limitPrice),
        price: price(order.limitPrice, order.tradingSymbolId, symbols),
        reservedMargin: order.action === "OPEN"
          ? `${formatDecimal(order.reservedMargin)} USDT`
          : `청산 예약 ${formatEditableDecimal(order.reservedCloseQuantity) || formatEditableDecimal(order.quantity)} ${unit}`,
        reservedFee: order.action === "OPEN" ? `${formatDecimal(order.reservedFee)} USDT` : "—",
        feeRate: formatDecimal(order.feeRate),
        status: <Result order={order} />,
        time: kst(order.createdAt),
        action: (
          <div className="pending-row-actions">
            {order.type === "LIMIT" && order.status === "PENDING" && (
              <PendingOrderAmend order={order} symbol={symName} symbolMeta={sym} />
            )}
            <CancelOrderButton orderId={order.orderId} symbol={symName} />
          </div>
        ),
      },
    };
  });

  return (
    <>
      <CancelAllOrdersButton count={orders.length} />
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
    </>
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
              {formatOrderTypeKr(order.type)}
              <small>{order.action === "LIQUIDATE" ? "강제청산" : order.action === "CLOSE" ? "청산" : "진입"}</small>
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
                    ? fill.reason === "TAKE_PROFIT"
                      ? "익절 청산"
                      : fill.reason === "STOP_LOSS"
                        ? "손절 청산"
                        : "청산"
                    : "진입"}
              </small>
            </span>
          ),
          type: formatOrderTypeKr(fill.type),
          quantity: quantity(fill.quantity, fill.tradingSymbolId, symbols, fill.price),
          price: price(fill.price, fill.tradingSymbolId, symbols),
          gross: <span data-trend={pnlTrend(fill.realizedPnl)}>{formatDecimal(fill.realizedPnl)} USDT</span>,
          fee: `${formatDecimal(fill.fee)} USDT`,
          settlement: `${formatDecimal(fill.settlementAdjustment)} USDT`,
          marginMode: fill.marginMode === "ISOLATED" ? "격리" : fill.marginMode === "CROSS" ? "교차" : fill.marginMode,
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
          status: formatPositionStatusKr(position.status),
          quantity: quantity(position.initialQuantity, position.tradingSymbolId, symbols, position.entryPrice),
          entry: price(position.entryPrice, position.tradingSymbolId, symbols),
          exit: price(position.exitPrice, position.tradingSymbolId, symbols),
          margin: `${formatDecimal(position.initialMargin)} USDT`,
          gross: <span data-trend={pnlTrend(position.realizedPnl)}>{formatDecimal(position.realizedPnl)} USDT</span>,
          fees: `${formatDecimal(position.feesPaid)} USDT`,
          adjustment: `${formatDecimal(position.settlementAdjustment)} USDT`,
          net: <span data-trend={pnlTrend(position.netRealizedPnl)}>{formatDecimal(position.netRealizedPnl)} USDT</span>,
          mode: `${position.openedMarginMode === "ISOLATED" ? "격리" : position.openedMarginMode === "CROSS" ? "교차" : position.openedMarginMode} / ${position.closingMarginMode === "ISOLATED" ? "격리" : position.closingMarginMode === "CROSS" ? "교차" : position.closingMarginMode}`,
          opened: kst(position.openedAt),
          time: kst(position.closedAt),
        },
      }))}
    />
  );
}
