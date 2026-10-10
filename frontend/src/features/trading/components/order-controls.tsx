import type { ReactNode } from "react";

type Choice = { value: string; label: string };

export function OrderChoices({
  legend,
  name,
  choices,
  selected,
}: {
  legend: string;
  name: string;
  choices: readonly Choice[];
  selected: string;
}) {
  return (
    <fieldset disabled className="min-w-0">
      <legend className="sr-only">{legend}</legend>
      <div className="order-choices">
        {choices.map((choice) => (
          <label key={choice.value} className="order-choice">
            <input type="radio" name={name} value={choice.value} defaultChecked={choice.value === selected} className="sr-only" />
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
}: {
  id: string;
  label: string;
  unit: string;
  placeholder: string;
  hint?: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      <div className="order-input">
        <input id={id} name={id} type="text" inputMode="decimal" placeholder={placeholder} disabled aria-describedby={hint ? `${id}-hint` : undefined} className="w-full min-w-0 bg-transparent py-2.5 text-sm tabular-nums placeholder:text-slate-400 lg:py-2" />
        <span className="text-xs font-medium text-slate-500">{unit}</span>
      </div>
      {hint && <p id={`${id}-hint`} className="mt-1.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
