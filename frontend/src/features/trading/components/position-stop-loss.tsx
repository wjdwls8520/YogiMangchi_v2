"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGuestSession } from "./trading-data-provider";
import { formatDecimal, pnlTrend, type Position } from "../api/account";
import { parseStopLoss, latestStopLoss, type StopLoss, type StopLossCommand } from "../api/stop-loss-contract";
import { tradingKeys } from "../api/query-keys";
import { retryTradingQuery, TradingApiError } from "../api/client";
import { mutationStillUnconfirmed, mutationMessage } from "../api/mutation-request";
import { formatEditableDecimal, stepDecimalPrice, validLimitPrice } from "../api/order-input";
import { useTradingAdmission } from "../api/recovery";
import { formatMarketPrice } from "../market/price-format";
import { useJournalResolution } from "../api/journal-resolution";
import { usePositionMarkets } from "./selected-market-provider";
import { positionValuation, stopLossEstimate, stopLossRoePreset } from "../api/position-display";

function errorMessage(error: unknown) {
  const messages: Record<string, string> = {
    INVALID_STOP_LOSS: "양수 손절 가격을 입력해 주세요.",
    STOP_LOSS_NOT_PROTECTIVE: "LONG은 현재 Mark 미만, SHORT는 현재 Mark 초과로 설정해 주세요.",
    STOP_LOSS_BEYOND_LIQUIDATION: "강제청산 예상가보다 먼저 도달하는 가격으로 설정해 주세요.",
    STOP_LOSS_VERSION_CONFLICT: "손절 설정이 변경되었습니다. 최신 상태를 확인해 주세요.",
  };
  return (error instanceof TradingApiError && error.code && messages[error.code]) || mutationMessage(error);
}

export function PositionStopLoss({
  position,
  symbol,
  priceTickSize,
  initialPrice = "",
}: {
  position: Position;
  symbol: string;
  priceTickSize?: string | null;
  initialPrice?: string;
}) {
  const { session, snapshot } = useGuestSession();
  const client = useQueryClient();
  const admission = useTradingAdmission();
  const positionPrices = usePositionMarkets();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const active = useRef(false);
  const unresolved = useRef<{ command: StopLossCommand; key: string; accountId: number | null; generation: number } | null>(null);
  const [journalRequest, setJournalRequest] = useState<{ accountId: number | null; key: string; command: { kind: "stopLoss" } & StopLossCommand } | null>(null);
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(initialPrice);
  const [pending, setPending] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [message, setMessage] = useState("");

  const identity = `${snapshot.accountId}:${snapshot.generation}`;
  const query = useQuery({
    queryKey: [...tradingKeys.account(snapshot), "stop-loss", position.id],
    enabled: open && snapshot.phase === "ready",
    retry: retryTradingQuery,
    structuralSharing: (old, value) => latestStopLoss(old as StopLoss | undefined, value as StopLoss)!,
    queryFn: async ({ signal }) =>
      parseStopLoss(
        await session.read(`account/positions/${position.id}/stop-loss`, snapshot, signal),
        position.id,
        position.tradingSymbolId,
        position.side,
      ),
  });

  const current = latestStopLoss(query.data, position.stopLoss);
  const markEntry = positionPrices[position.tradingSymbolId] as { decimal?: string; price?: string } | null | undefined;
  const liveMark = markEntry?.price ?? positionValuation(position, positionPrices[position.tradingSymbolId]).mark ?? markEntry?.decimal ?? position.markPrice;
  const estimate = stopLossEstimate(position, price, liveMark);
  const baseSymbol = symbol.split(" /")[0]?.trim() || symbol;

  useJournalResolution(journalRequest, () => {
    unresolved.current = null;
    setJournalRequest(null);
    setUnknown(false);
    setMessage("");
    void query.refetch();
  });

  function openModal() {
    if (snapshot.phase !== "ready" || dialog.current?.open) return;
    setMessage("");
    setPrice(current?.status === "ACTIVE" && current.stopPrice ? formatEditableDecimal(current.stopPrice) : initialPrice);
    setOpen(true);
    dialog.current?.showModal();
  }

  function closeModal() {
    if (pending) return;
    setMessage("");
    dialog.current?.close();
  }

  function handleStep(delta: 1 | -1) {
    if (pending || unknown) return;
    const next = stepDecimalPrice(price, current?.stopPrice ?? liveMark ?? position.entryPrice, priceTickSize, delta);
    if (next) {
      setMessage("");
      setPrice(next);
    }
  }

  async function submit(remove = false) {
    if (active.current || snapshot.phase !== "ready") return;
    if (!unresolved.current && (!current || query.isError || !(remove ? admission.cancel : admission.trade))) {
      setMessage("현재 서버 상태에서는 요청을 처리할 수 없습니다.");
      return;
    }
    if (unresolved.current && (unresolved.current.accountId !== snapshot.accountId || unresolved.current.generation !== snapshot.generation)) {
      unresolved.current = null;
      setJournalRequest(null);
      setUnknown(false);
      return;
    }
    const request = unresolved.current ?? {
      command: { positionId: position.id, expectedVersion: current!.version, ...(remove ? {} : { stopPrice: price.trim() }) },
      key: crypto.randomUUID(),
      accountId: snapshot.accountId,
      generation: snapshot.generation,
    };
    const wasUnconfirmed = !!unresolved.current;
    active.current = true;
    setPending(true);
    setMessage("");
    const same = () => `${session.getSnapshot().accountId}:${session.getSnapshot().generation}` === identity;
    try {
      const result = parseStopLoss(await session.writeStopLoss(request.command, snapshot, request.key), position.id, position.tradingSymbolId, position.side);
      if (!same()) return;
      unresolved.current = null;
      setJournalRequest(null);
      setUnknown(false);
      setPrice("");
      client.setQueryData([...tradingKeys.account(snapshot), "stop-loss", position.id], (old: StopLoss | undefined) => latestStopLoss(old, position.stopLoss, result));
      dialog.current?.close();
    } catch (error) {
      if (!same()) return;
      unresolved.current = mutationStillUnconfirmed(error, wasUnconfirmed) ? request : null;
      setJournalRequest(unresolved.current ? { accountId: request.accountId, key: request.key, command: { kind: "stopLoss", ...request.command } } : null);
      setUnknown(!!unresolved.current);
      setMessage(errorMessage(error));
    } finally {
      if (same()) {
        setPending(false);
        void query.refetch();
        void client.invalidateQueries({ queryKey: [...tradingKeys.account(snapshot), "summary"] });
      }
      active.current = false;
    }
  }

  return (
    <div className="position-stop-loss">
      <button
        ref={trigger}
        type="button"
        className="whitespace-nowrap shrink-0"
        aria-haspopup="dialog"
        aria-label={`${symbol} ${position.side} 손절 설정`}
        disabled={snapshot.phase !== "ready"}
        onClick={openModal}
      >
        {current?.status === "ACTIVE" ? `SL ${formatMarketPrice(current.stopPrice, priceTickSize)}` : "SL 설정"}
      </button>
      <dialog
        ref={dialog}
        className="position-close-dialog ym-exchange-modal"
        aria-modal="true"
        aria-labelledby={`stop-loss-${position.id}`}
        onClick={(event) => {
          if (event.target === event.currentTarget && event.detail < 2 && !pending) closeModal();
        }}
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
        onClose={() => {
          setOpen(false);
          setMessage("");
          trigger.current?.focus({ preventScroll: true });
        }}
      >
        <header className="ym-modal-header">
          <div className="ym-modal-title-group">
            <h2 id={`stop-loss-${position.id}`}>Stop Loss</h2>
            <span className="ym-modal-badge" data-side={position.side}>
              {baseSymbol}USDT · {position.side === "LONG" ? "Long" : "Short"} {position.leverage}×
            </span>
          </div>
          <button type="button" className="ym-modal-close" aria-label="닫기" disabled={pending} onClick={closeModal}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <dl className="ym-modal-kv-list">
          <div>
            <dt>Entry Price</dt>
            <dd>{formatMarketPrice(position.entryPrice, priceTickSize)}</dd>
          </div>
          <div>
            <dt>Mark Price</dt>
            <dd>{formatMarketPrice(liveMark, priceTickSize)}</dd>
          </div>
          <div>
            <dt>Liq. Price</dt>
            <dd className="ym-modal-liq">{position.liquidationPrice ? formatMarketPrice(position.liquidationPrice, priceTickSize) : "—"}</dd>
          </div>
          {current?.status === "ACTIVE" && current.stopPrice && (
            <div>
              <dt>Active SL</dt>
              <dd className="ym-modal-active-sl">
                <span>{formatMarketPrice(current.stopPrice, priceTickSize)}</span>
                <button
                  type="button"
                  className="ym-modal-inline-clear"
                  disabled={pending || unknown || !admission.cancel}
                  onClick={() => void submit(true)}
                >
                  해제
                </button>
              </dd>
            </div>
          )}
        </dl>

        {query.isPending && !current && <p role="status" className="ym-modal-subtle">상태 확인 중…</p>}
        {query.isError && (
          <p role="alert" className="ym-modal-alert">
            설정을 불러오지 못했습니다.{" "}
            <button type="button" className="ym-modal-inline-clear" onClick={() => void query.refetch()}>
              재시도
            </button>
          </p>
        )}

        {(current || unknown) && (
          <form
            className="ym-modal-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="ym-modal-field">
              <div className="ym-modal-field-head">
                <label htmlFor={`sl-price-${position.id}`}>
                  Stop Loss <span>USDT</span>
                </label>
                <span className="ym-modal-field-meta">
                  Qty <strong>{formatEditableDecimal(position.quantity)}</strong> {baseSymbol}
                </span>
              </div>
              <div className="ym-modal-input-row">
                <div className="ym-modal-stepper-box">
                  <input
                    id={`sl-price-${position.id}`}
                    inputMode="decimal"
                    autoComplete="off"
                    value={price}
                    disabled={pending || unknown}
                    placeholder={current?.stopPrice ? formatEditableDecimal(current.stopPrice) : "가격 입력"}
                    onChange={(event) => {
                      setMessage("");
                      setPrice(event.target.value);
                    }}
                  />
                  <div className="ym-modal-steppers">
                    <button type="button" aria-label="손절 가격 내리기" disabled={pending || unknown} onClick={() => handleStep(-1)}>
                      −
                    </button>
                    <i aria-hidden="true" />
                    <button type="button" aria-label="손절 가격 올리기" disabled={pending || unknown} onClick={() => handleStep(1)}>
                      +
                    </button>
                  </div>
                </div>
                <div className="ym-modal-trigger-box" title="서버 Mark Price 기준 발동">
                  <span>Mark</span>
                </div>
              </div>
              <div className="ym-modal-preset-bar" role="group" aria-label="손절 ROE 프리셋">
                {([10, 25, 50, 75] as const).map((loss) => {
                  const target = stopLossRoePreset(position, loss);
                  const isSelected = Boolean(target && price.trim() === target);
                  return (
                    <button
                      key={loss}
                      type="button"
                      data-active={isSelected || undefined}
                      disabled={pending || unknown}
                      onClick={() => {
                        if (target) {
                          setMessage("");
                          setPrice(target);
                        }
                      }}
                    >
                      -{loss}%
                    </button>
                  );
                })}
              </div>
            </div>

            {estimate && !estimate.warning && (
              <div role="status" className="ym-modal-estimate">
                <span>
                  Est. PnL{" "}
                  <strong data-trend={pnlTrend(estimate.grossPnl)}>
                    {formatDecimal(estimate.grossPnl)} USDT ({formatDecimal(estimate.estimatedRoe)}%)
                  </strong>
                </span>
                <span>
                  Fee <strong>{formatDecimal(estimate.estimatedFee)} USDT</strong>
                </span>
              </div>
            )}

            {(message || estimate?.warning) && (
              <p role="alert" className="ym-modal-alert">
                {message || estimate?.warning}
              </p>
            )}

            {unknown && (
              <p className="ym-modal-alert">
                결과가 미확정입니다. 재전송 시 이전 요청이 반영될 수 있습니다.
              </p>
            )}

            <div className="ym-modal-footer">
              {unknown ? (
                <button
                  type="button"
                  className="ym-modal-btn-confirm"
                  disabled={pending}
                  onClick={() => void submit(unresolved.current?.command.stopPrice === undefined)}
                >
                  {pending ? "처리 중…" : "요청 재전송"}
                </button>
              ) : (
                <button
                  type="submit"
                  className="ym-modal-btn-confirm"
                  disabled={pending || !admission.trade || !validLimitPrice(price.trim()) || Boolean(estimate?.warning)}
                >
                  {pending ? "처리 중…" : "확인"}
                </button>
              )}
              <button type="button" className="ym-modal-btn-cancel" disabled={pending} onClick={closeModal}>
                취소
              </button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
