import type { ReactNode } from "react";

type Choice = { value: string; label: string };

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
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      <div className="order-input">
        <input id={id} name={id} type="text" inputMode="decimal" placeholder={placeholder} value={value} onChange={(event) => onChange?.(event.target.value)} disabled={disabled} aria-describedby={hint ? `${id}-hint` : undefined} className="w-full min-w-0 bg-transparent py-2.5 text-trade-body tabular-nums placeholder:text-slate-400 lg:py-2" />
        <span className="text-trade-meta font-medium text-slate-500">{unit}</span>
      </div>
      {hint && <p id={`${id}-hint`} className="order-input-hint">{hint}</p>}
    </div>
  );
}
