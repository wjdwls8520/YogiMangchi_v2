import type { ReactNode } from "react";
import { MAX_INPUT_LEVERAGE, SERVER_MAX_LEVERAGE } from "../api/order-input";

type Choice = { value: string; label: string };

export function OrderLeverage({ value, max = MAX_INPUT_LEVERAGE, disabled, onChange }: { value?: number; max?: number; disabled: boolean; onChange: (value: number) => void }) {
  return <div className="order-leverage"><label htmlFor="symbol-leverage" className="field-label">공통 레버리지 · Cross</label>
    <select id="symbol-leverage" value={value ?? ""} disabled={disabled} onChange={event => onChange(Number(event.target.value))} className="order-leverage-input">
      {value === undefined && <option value="">서버 설정 확인 중</option>}
      {Array.from({length:Math.min(max, SERVER_MAX_LEVERAGE)},(_,i)=>i+1).map(value=><option key={value} value={value}>{value}×</option>)}
    </select>
    <p className="order-input-hint">선택 종목의 Long · Short에 함께 적용됩니다.</p>
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
