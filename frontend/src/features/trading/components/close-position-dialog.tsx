"use client";

import type { RefObject } from "react";
import type { Position } from "../api/account";
import { formatDecimal } from "../api/account";
import { OrderChoices, OrderInput } from "./order-controls";

export function ClosePositionDialog({ dialogRef, position, symbol, mark, pnl, type, quantity, limitPrice, ratio, locked, unconfirmed, warning, onType, onQuantity, onPrice, onRatio, onSubmit, onCancel, onClose }: {
  dialogRef: RefObject<HTMLDialogElement | null>; position: Position; symbol: string; mark: string; pnl: string;
  type: "MARKET" | "LIMIT"; quantity: string; limitPrice: string; ratio: number; locked: boolean; unconfirmed: boolean; warning: string | null;
  onType: (type: string) => void; onQuantity: (value: string) => void; onPrice: (value: string) => void; onRatio: (percent: number) => void;
  onSubmit: () => void; onCancel: () => void; onClose: () => void;
}) {
  const prefix = `close-${position.id}`;
  return <dialog ref={dialogRef} className="position-close-dialog" aria-modal="true" aria-labelledby={`${prefix}-heading`}
    onCancel={(event) => { if (locked) event.preventDefault(); }} onClose={onClose}>
    <h2 id={`${prefix}-heading`}>{symbol} · {position.side} 청산</h2>
    <dl className="close-position-summary">
      <div><dt>보유 수량</dt><dd>{formatDecimal(position.quantity)}</dd></div>
      <div><dt>청산 예약</dt><dd>{formatDecimal(position.reservedCloseQuantity)}</dd></div>
      <div><dt>청산 가능 수량</dt><dd>{formatDecimal(position.freeCloseQuantity)}</dd></div>
      <div><dt>진입가</dt><dd>{formatDecimal(position.entryPrice)}</dd></div>
      <div><dt>Mark Price</dt><dd>{mark}</dd></div>
      <div><dt>미실현 손익 · 참고</dt><dd>{pnl} USDT</dd></div>
    </dl>
    <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <OrderChoices legend="청산 방식" name={`${prefix}-type`} selected={type} disabled={locked || unconfirmed} onChange={onType} choices={[{value:"MARKET",label:"시장가"},{value:"LIMIT",label:"지정가"}]} />
      {type === "LIMIT" && <OrderInput id={`${prefix}-price`} label="청산 지정가" unit="USDT" placeholder="가격 입력" value={limitPrice} disabled={locked || unconfirmed} onChange={onPrice} />}
      <OrderInput id={`${prefix}-quantity`} label="청산 수량" unit="" placeholder="수량 입력" value={quantity} disabled={locked || unconfirmed} onChange={onQuantity} />
      <OrderChoices legend="청산 가능 수량 비율" name={`${prefix}-ratio`} selected={String(ratio)} disabled={locked || unconfirmed} onChange={(value) => onRatio(Number(value))} choices={[25,50,75,100].map(value=>({value:String(value),label:`${value}%`}))} />
      <p className="order-input-hint">비율은 청산 가능 수량을 기준으로 한 번 계산합니다. 예약된 수량은 먼저 미체결 주문에서 취소해 주세요.</p>
      {warning && <p role="alert" className="order-warning">{warning}</p>}
      <p className="order-input-hint">실제 체결 가격·수량·손익은 서버가 결정합니다.</p>
      <div className="guest-dialog-actions"><button type="button" className="guest-cancel" disabled={locked} onClick={onCancel}>닫기</button>
        <button type="submit" className="guest-start-button" disabled={locked}>{locked ? "처리 중…" : unconfirmed ? "같은 청산 결과 확인" : type === "MARKET" ? "시장가 청산 확인" : "지정가 청산 예약"}</button></div>
    </form>
  </dialog>;
}
