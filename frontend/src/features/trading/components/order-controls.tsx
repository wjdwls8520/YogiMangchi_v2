import type { ReactNode } from "react";
import { MAX_INPUT_LEVERAGE, SERVER_MAX_LEVERAGE } from "../api/order-input";

type Choice = { value: string; label: string };

export function OrderLeverage({ side, value, disabled, onChange }: { side: "LONG" | "SHORT"; value: number; disabled: boolean; onChange: (value: number) => void }) {
  const id = `leverage-${side.toLowerCase()}`;
  return <div className="order-leverage"><label htmlFor={id} className="field-label" data-side={side}>{side === "LONG" ? "Long" : "Short"} 레버리지</label>
    <select id={id} value={value} disabled={disabled} onChange={event => onChange(Number(event.target.value))} data-side={side} aria-describedby={value>SERVER_MAX_LEVERAGE ? `${id}-support` : undefined} className="order-leverage-input">
      {Array.from({length:MAX_INPUT_LEVERAGE},(_,i)=>i+1).map(value=><option key={value} value={value}>{value}×{value>SERVER_MAX_LEVERAGE ? " · 대기" : ""}</option>)}
    </select>
    {value>SERVER_MAX_LEVERAGE && <p id={`${id}-support`} role="status" className="order-input-hint">현재 서버는 {SERVER_MAX_LEVERAGE}배까지 주문을 지원합니다.</p>}
  </div>;
}

export function OrderChoices({
  legend,
  name,
  choices,
  selected,
  onChange,
  disabled = false,
}: {
  legend: string;
  name: string;
  choices: readonly Choice[];
  selected: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="sr-only">{legend}</legend>
      <div className="order-choices">
        {choices.map((choice) => (
          <label key={choice.value} className="order-choice">
            <input type="radio" name={name} value={choice.value} checked={choice.value === selected} onChange={() => onChange?.(choice.value)} className="sr-only" />
            <span>{choice.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function OrderInput({
  id,
  label,
  unit,
  placeholder,
  hint,
  value = "",
  onChange,
  disabled = false,
}: {
  id: string;
  label: string;
  unit: string;
  placeholder: string;
  hint?: ReactNode;
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="order-field">
      <div className="order-input">
        <label htmlFor={id} className="field-label">{label}</label>
        <input id={id} name={id} type="text" inputMode="decimal" placeholder={placeholder} value={value} onChange={(event) => onChange?.(event.target.value)} disabled={disabled} aria-describedby={hint ? `${id}-hint` : undefined} className="w-full min-w-0 bg-transparent tabular-nums placeholder:text-terminal-muted" />
        <span className="text-trade-meta font-medium text-terminal-muted">{unit}</span>
      </div>
      {hint && <p id={`${id}-hint`} className="order-input-hint">{hint}</p>}
    </div>
  );
}
